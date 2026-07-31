// Video writer Web Worker. Owns the FileSystemWritableFileStream for a
// recording and performs every write off the main thread, for the same reason
// tsvWriterWorker does: the thread this would otherwise run on is the one that
// must not miss a Modbus deadline, and a video chunk is a great deal larger
// than a TSV row.
//
// The file is one the user chose a folder for, written straight through. There
// is deliberately no OPFS mirror here, unlike the TSV writer:
//
//   - The TSV mirror exists because a picked file stays 0 bytes until close(),
//     so a crash loses the whole run. That is just as true of video.
//   - But mirroring means writing every byte twice, and an hour of 720p is
//     gigabytes rather than the megabytes a TSV run produces. Doubling that on
//     the machine running the acquisition loop costs the measurement exactly
//     the disk bandwidth this app spends its time protecting.
//
// So the trade is stated rather than hidden: a recording interrupted by a crash
// is lost, and the panel says so next to the button that starts one.
import type { VideoWorkerRequest, VideoWorkerResponse } from './utils/videoWorkerProtocol';

let stream: FileSystemWritableFileStream | null = null;
let bytesWritten = 0;
// Serialises writes so chunks cannot interleave and corrupt the file. Kept
// resolved so one failed write does not stall every later one.
let writeChain: Promise<void> = Promise.resolve();

function post(message: VideoWorkerResponse): void {
  self.postMessage(message);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function enqueue(data: ArrayBuffer): void {
  writeChain = writeChain
    .then(async () => {
      if (!stream) return;
      await stream.write(data);
      bytesWritten += data.byteLength;
    })
    .catch((err) => {
      // Reported once per failure rather than swallowed: a disk that filled up
      // mid-recording is something the user has to know about while there is
      // still a measurement running that they might want to stop.
      post({ type: 'error', message: `Recording write failed: ${errorMessage(err)}` });
    });
}

self.onmessage = async (event: MessageEvent<VideoWorkerRequest>) => {
  const msg = event.data;
  try {
    switch (msg.type) {
      case 'init': {
        stream = await msg.fileHandle.createWritable();
        post({ type: 'ready' });
        break;
      }
      case 'chunk': {
        if (stream) {
          enqueue(msg.data);
        } else {
          // Reported rather than dropped quietly. A chunk arriving after close
          // means the stop path let the file be closed while data was still on
          // its way, which is exactly the fault that produces a 0-byte
          // recording — it must not be able to happen without saying so.
          post({
            type: 'error',
            message: `Recording lost ${msg.data.byteLength} bytes that arrived after the file was closed.`,
          });
        }
        break;
      }
      case 'close': {
        // Drain first, then close: close() on a stream with writes still queued
        // truncates the tail, which for video is the last seconds of whatever
        // the user was recording.
        await writeChain;
        try {
          await stream?.close();
        } catch (err) {
          post({ type: 'error', message: `Could not finish the recording: ${errorMessage(err)}` });
        }
        stream = null;
        // Always reply, even after a failed close, so the main thread's await
        // never hangs.
        post({ type: 'closed', bytes: bytesWritten });
        break;
      }
    }
  } catch (err) {
    post({ type: 'error', message: errorMessage(err) });
  }
};
