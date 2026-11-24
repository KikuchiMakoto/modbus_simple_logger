(function(){let e=new URL(`/modbus_simple_logger/pyodide/`,self.location.href).href,t=null,n=null,r=null,i=!1,a=null,o=null,s=null,c=null,l=null,u=null,d=performance.now(),f=e=>{self.postMessage(e)},p=(e,t)=>!e||!Number.isInteger(t)||t<0||t>=e.length?0:e[t]??0,m=(e,t)=>{t!==``&&f({type:`output`,stream:e,text:t})},h=e=>{let t=e.split(`
`),n=[],r=!1;for(let e of t){if(/^\s{2}File "/.test(e)){if(r=e.includes(`/_pyodide/`)||e.includes(`, in _runner_run`),r)continue}else if(r){if(/^\s{3,}/.test(e))continue;r=!1}n.push(e)}return n.join(`
`)},g=e=>{let t=e.split(`
`).map(e=>e.trimEnd()).filter(e=>e!==``),n=t[t.length-1];return n===void 0||n===``?e:n},_=(e,t,n)=>{e&&(!Number.isInteger(t)||t<0||t>=e.length||(e[t]=n))},v=async(n,r,i,a,h)=>{f({type:`status`,message:`Initializing Pyodide...`}),o=new Float32Array(n),s=new Float32Array(r),c=new Float32Array(i),l=new Float32Array(a),u=new Uint8Array(h);let{loadPyodide:g}=await import(
/* @vite-ignore */
`${e}pyodide.mjs`);t=await g({indexURL:e}),t.setStdout({batched:e=>m(`stdout`,e)}),t.setStderr({batched:e=>m(`stderr`,e)}),t.runPython(`
import asyncio
from pyodide.code import eval_code_async

class _ScriptRunner:
    task = None

async def _runner_run(code):
    _ScriptRunner.task = asyncio.ensure_future(eval_code_async(code, globals=globals()))
    try:
        await _ScriptRunner.task
    except SystemExit:
        # exit() / quit() / sys.exit() — Pyodide 314 ships the full stdlib so
        # these now exist and raise SystemExit. Treat them as a normal end of
        # the script rather than an error.
        pass
    finally:
        _ScriptRunner.task = None

def _runner_stop():
    task = _ScriptRunner.task
    if task is not None and not task.done():
        task.cancel()
        return True
    return False
`);let v=t,y=(e,t)=>{v.globals.set(e,t)};y(`GetAiRaw`,e=>p(o,Number(e))),y(`GetAiPhy`,e=>p(s,Number(e))),y(`GetAo`,e=>p(c,Number(e))),y(`SetAo`,(e,t)=>{f({type:`set_ao`,ch:Number(e),data:Number(t)})}),y(`SetAiTare`,e=>{f({type:`set_ai_tare`,ch:Number(e)})}),y(`GetParam`,e=>p(l,Number(e))),y(`SetParam`,(e,t)=>{_(l,Number(e),Number(t))}),y(`SetParamLabel`,(e,t)=>{f({type:`set_param_label`,ch:Number(e),text:String(t)})}),y(`Elapsed`,()=>(performance.now()-d)/1e3),t.setInterruptBuffer(u),f({type:`status`,message:`Ready`})};self.onmessage=async e=>{let o=e.data;if(o.type===`init`){r=o,a=new Int32Array(o.runSab),n||=v(o.rawSab,o.phySab,o.aoSab,o.paramSab,o.intSab);try{await n}catch(e){n=null,f({type:`error`,message:e.message})}}else if(o.type===`interrupt`){if(t&&i){u&&(u[0]=0);try{t.runPython(`_runner_stop()`)}catch{}}}else if(o.type===`run`){let{runId:e}=o,s=!1;if(!n){if(!r){f({type:`error`,runId:e,message:`Worker is not initialized`});return}n=v(r.rawSab,r.phySab,r.aoSab,r.paramSab,r.intSab)}if(i){f({type:`error`,runId:e,message:`Script is already running`});return}try{if(await n,!t)throw Error(`Pyodide is not available`);if(a&&Atomics.load(a,0)!==e)return;if(i){f({type:`error`,runId:e,message:`Script is already running`});return}if(s=!0,u&&u[0]===2){f({type:`interrupted`,runId:e,message:`Stopped`});return}i=!0,d=performance.now(),f({type:`status`,message:`Running`}),t.globals.set(`__user_code__`,o.code),await t.runPythonAsync(`await _runner_run(__user_code__)`),f({type:`done`,runId:e,message:`Completed`})}catch(r){let i=r,a=i.message??String(i);t||(n=null),a.includes(`KeyboardInterrupt`)||a.includes(`CancelledError`)?f({type:`interrupted`,runId:e,message:`Stopped`}):a.includes(`SystemExit`)?f({type:`done`,runId:e,message:`Completed`}):f({type:`error`,runId:e,message:g(a),traceback:h(a)})}finally{s&&(i=!1,u&&(u[0]=0))}}}})();