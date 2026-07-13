import { FloatingWindow } from './FloatingWindow';

const CABLE_ROWS = [
  {
    color: 'Red / R / 紅',
    dot: 'bg-red-500',
    abbr: 'E+',
    name: 'Excitation +',
    strain: '入力 +',
    elec: '電源',
    ndis: 'A',
  },
  {
    color: 'Green / G / 緑',
    dot: 'bg-green-500',
    abbr: 'S+',
    name: 'Signal +',
    strain: '出力 +',
    elec: '正出力',
    ndis: 'B',
  },
  {
    color: 'Black / B / 黒',
    dot: 'bg-slate-800 dark:bg-slate-400',
    abbr: 'E−',
    name: 'Excitation −',
    strain: '入力 −',
    elec: 'グランド',
    ndis: 'C',
  },
  {
    color: 'White / W / 白',
    dot: 'bg-slate-200 border border-slate-400',
    abbr: 'S−',
    name: 'Signal −',
    strain: '出力 −',
    elec: '負出力',
    ndis: 'D',
  },
  {
    color: 'Yellow / Y / 黄',
    dot: 'bg-yellow-400',
    abbr: 'SH',
    name: 'Shield',
    strain: 'シールド',
    elec: 'シールド',
    ndis: 'E',
  },
];

export function ManualPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <FloatingWindow open={open} onClose={onClose} title="Manual" defaultWidth={520} defaultHeight={620}>
      <div className="flex flex-col gap-5 overflow-y-auto p-4 text-sm text-slate-700 dark:text-slate-200">

        {/* HX711 Cable Wiring */}
        <section>
          <h3 className="mb-2 font-bold text-emerald-600 dark:text-emerald-400">
            HX711 ケーブル接続（ロードセル・変位計）
          </h3>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            ⚠️ ケーブル色はメーカーにより異なる場合があります。必ずデータシートを確認してください。
          </p>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-slate-100 text-left text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                  <th className="px-2 py-1.5">色</th>
                  <th className="px-2 py-1.5">略称</th>
                  <th className="px-2 py-1.5">機能（英語）</th>
                  <th className="px-2 py-1.5">機能（ひずみ）</th>
                  <th className="px-2 py-1.5">電気的機能</th>
                  <th className="px-2 py-1.5">NDIS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-700/60">
                {CABLE_ROWS.map((row) => (
                  <tr
                    key={row.abbr}
                    className="bg-white hover:bg-slate-50 dark:bg-slate-900 dark:hover:bg-slate-800/50"
                  >
                    <td className="flex items-center gap-1.5 px-2 py-1.5 font-medium whitespace-nowrap">
                      <span className={`inline-block h-3 w-3 flex-shrink-0 rounded-full ${row.dot}`} />
                      {row.color}
                    </td>
                    <td className="px-2 py-1.5 font-mono font-semibold">{row.abbr}</td>
                    <td className="px-2 py-1.5">{row.name}</td>
                    <td className="px-2 py-1.5">{row.strain}</td>
                    <td className="px-2 py-1.5">{row.elec}</td>
                    <td className="px-2 py-1.5 font-mono font-semibold">{row.ndis}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* NDIS Connector Layout */}
        <section>
          <h3 className="mb-2 font-bold text-emerald-600 dark:text-emerald-400">
            NDISコネクタ ピン配置
          </h3>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            NDIS（日本工業規格 JIS B 7505 相当）の5ピンコネクタ。ロードセル・変位計に広く使用されます。
          </p>
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800">
            {/* Visual connector layout */}
            <div className="flex flex-col items-center gap-1">
              <div className="grid grid-cols-2 gap-1">
                <Pin label="B" sub="S+" color="bg-green-500 text-white" />
                <Pin label="A" sub="E+" color="bg-red-500 text-white" />
              </div>
              <div className="grid grid-cols-3 gap-1">
                <Pin label="C" sub="E−" color="bg-black text-white border border-gray-500" />
                <Pin label="G" sub="" color="bg-slate-500 text-white dark:bg-slate-700" />
                <Pin label="F" sub="" color="bg-slate-500 text-white dark:bg-slate-700" />
               </div>
              <div className="grid grid-cols-2 gap-1">
                <Pin label="D" sub="S−" color="bg-slate-100 text-slate-700 border border-slate-400" />
                <Pin label="E" sub="SH" color="bg-yellow-400 text-slate-800" />
              </div>
              <span className="mt-1 text-xs text-slate-400">（ソケット正面）</span>
            </div>
            <dl className="flex-1 space-y-0.5 text-xs">
              {CABLE_ROWS.map((row) => (
                <div key={row.ndis} className="flex gap-1">
                  <dt className="w-8 shrink-0 font-mono font-bold">{row.ndis}</dt>
                  <dd className="text-slate-600 dark:text-slate-300">
                    {row.abbr} — {row.elec}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Screw Connector (ADS1115 / GP8403) */}
        <section>
          <h3 className="mb-2 font-bold text-emerald-600 dark:text-emerald-400">
            スクリューコネクタ配線（ADS1115 / GP8403）
          </h3>
          <p className="mb-2 text-xs text-slate-500 dark:text-slate-400">
            基板上の 01×02 スクリューコネクタは、シルク印刷に <span className="font-mono font-bold text-slate-700 dark:text-slate-200">"G"</span> と表示されているピンが<strong>グランド（GND）</strong>です。
          </p>
          <div className="flex items-stretch gap-3 rounded-lg border border-slate-200 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800 text-xs">
            {/* Visual screw connector */}
            <div className="flex flex-col items-center justify-center gap-1">
              <div className="flex flex-col gap-1">
                <div className="flex items-center justify-center rounded border-2 border-slate-400 bg-white px-3 py-1.5 font-mono font-bold text-slate-700 dark:border-slate-500 dark:bg-slate-700 dark:text-slate-100 w-16 text-center">
                  SIG
                </div>
                <div className="flex items-center justify-center rounded border-2 border-slate-400 bg-slate-800 px-3 py-1.5 font-mono font-bold text-white w-16 text-center">
                  G
                </div>
              </div>
              <span className="mt-1 text-xs text-slate-400">（基板シルク）</span>
            </div>
            <dl className="flex flex-col justify-center space-y-1 text-xs">
              <div className="flex items-baseline gap-2">
                <dt className="w-10 shrink-0 rounded border border-slate-300 bg-white px-1 py-0.5 text-center font-mono font-bold dark:border-slate-600 dark:bg-slate-700">SIG</dt>
                <dd className="text-slate-600 dark:text-slate-300">チャンネル番号（16進）</dd>
              </div>
              <div className="flex items-baseline gap-2">
                <dt className="w-10 shrink-0 rounded border border-slate-300 bg-slate-800 px-1 py-0.5 text-center font-mono font-bold text-white dark:border-slate-600">G</dt>
                <dd className="text-slate-600 dark:text-slate-300">グランド（GND）— シルク印刷 "G" の側</dd>
              </div>
            </dl>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
            SIG はチャンネル番号を16進数で示します（例: 10→A, 15→F）。ADS1115 側は 8〜15 のため、表示は
            8〜F です。
          </p>
        </section>

        {/* Reference */}
        <section>
          <h3 className="mb-2 font-bold text-emerald-600 dark:text-emerald-400">参考資料</h3>
          <ul className="space-y-1 text-xs">
            <li>
              <a
                href="https://www.showa-sokki.co.jp/technology/%E3%82%B3%E3%83%8D%E3%82%AF%E3%82%BF%E7%A8%AE%E9%A1%9E%E3%81%A8%E6%8E%A5%E7%B6%9A%E6%96%B9%E6%B3%95/"
                target="_blank"
                rel="noopener noreferrer"
                className="text-emerald-600 hover:underline dark:text-emerald-400"
              >
                昭和測器 — コネクタ種類と接続方法
              </a>
            </li>
          </ul>
        </section>

      </div>
    </FloatingWindow>
  );
}

function Pin({ label, sub, color }: { label: string; sub: string; color: string }) {
  return (
    <div className={`flex h-10 w-10 flex-col items-center justify-center rounded-full text-center text-xs font-bold leading-tight ${color}`}>
      <span>{label}</span>
      <span className="text-[9px] font-normal opacity-80">{sub}</span>
    </div>
  );
}
