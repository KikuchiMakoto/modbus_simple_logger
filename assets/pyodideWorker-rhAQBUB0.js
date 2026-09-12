(function(){let e=new URL(`/modbus_simple_logger/pyodide/`,self.location.href).href,t=null,n=null,r=null,i=!1,a=null,o=null,s=null,c=null,l=null,u=Date.now(),d=e=>{self.postMessage(e)},f=(e,t)=>!e||!Number.isInteger(t)||t<0||t>=e.length?0:e[t]??0,p=(e,t)=>{t!==``&&d({type:`output`,stream:e,text:t})},m=e=>{let t=e.split(`
`),n=[],r=!1;for(let e of t){if(/^\s{2}File "/.test(e)){if(r=e.includes(`/_pyodide/`)||e.includes(`, in _runner_run`),r)continue}else if(r){if(/^\s{3,}/.test(e))continue;r=!1}n.push(e)}return n.join(`
`)},h=e=>{let t=e.split(`
`).map(e=>e.trimEnd()).filter(e=>e!==``),n=t[t.length-1];return n===void 0||n===``?e:n},g=(e,t,n)=>{e&&(!Number.isInteger(t)||t<0||t>=e.length||(e[t]=n))},_=async(n,r,i,m,h)=>{d({type:`status`,message:`Initializing Pyodide...`}),a=new Float32Array(n),o=new Float32Array(r),s=new Float32Array(i),c=new Float32Array(m),l=new Uint8Array(h);let{loadPyodide:_}=await import(`${e}pyodide.mjs`);t=await _({indexURL:e}),t.setStdout({batched:e=>p(`stdout`,e)}),t.setStderr({batched:e=>p(`stderr`,e)}),t.runPython(`
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
`);let v=t,y=(e,t)=>{v.globals.set(e,t)};y(`GetAiRaw`,e=>f(a,Number(e))),y(`GetAiPhy`,e=>f(o,Number(e))),y(`GetAo`,e=>f(s,Number(e))),y(`SetAo`,(e,t)=>{d({type:`set_ao`,ch:Number(e),data:Number(t)})}),y(`SetAiTare`,e=>{d({type:`set_ai_tare`,ch:Number(e)})}),y(`GetParam`,e=>f(c,Number(e))),y(`SetParam`,(e,t)=>{g(c,Number(e),Number(t))}),y(`SetParamLabel`,(e,t)=>{d({type:`set_param_label`,ch:Number(e),text:String(t)})}),y(`Elapsed`,()=>(Date.now()-u)/1e3),t.setInterruptBuffer(l),d({type:`status`,message:`Ready`})};self.onmessage=async e=>{let a=e.data;if(a.type===`init`){r=a,n||=_(a.rawSab,a.phySab,a.aoSab,a.paramSab,a.intSab);try{await n}catch(e){n=null,d({type:`error`,message:e.message})}return}if(a.type===`interrupt`){if(t&&i){l&&(l[0]=0);try{t.runPython(`_runner_stop()`)}catch{}}else l&&(l[0]=2);return}if(a.type===`run`){if(!n){if(!r){d({type:`error`,message:`Worker is not initialized`});return}n=_(r.rawSab,r.phySab,r.aoSab,r.paramSab,r.intSab)}if(i){d({type:`error`,message:`Script is already running`});return}try{if(await n,!t)throw Error(`Pyodide is not available`);if(l&&l[0]===2){d({type:`interrupted`,message:`Stopped`});return}i=!0,u=Date.now(),d({type:`status`,message:`Running`}),t.globals.set(`__user_code__`,a.code),await t.runPythonAsync(`await _runner_run(__user_code__)`),d({type:`done`,message:`Completed`})}catch(e){let r=e,i=r.message??String(r);t||(n=null),i.includes(`KeyboardInterrupt`)||i.includes(`CancelledError`)?d({type:`interrupted`,message:`Stopped`}):i.includes(`SystemExit`)?d({type:`done`,message:`Completed`}):d({type:`error`,message:h(i),traceback:m(i)})}finally{i=!1,l&&(l[0]=0)}}}})();