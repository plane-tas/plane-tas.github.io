// Convolution worker: one of several that share a 2D map between the CPU
// cores.  The work itself is in convolution-lattice.js (createEngine), which
// the page also uses directly when workers cannot start.
import {createEngine} from './convolution-lattice.js';
import {calcResolution} from '../resolution/resolution-core.js';

const engine=createEngine(calcResolution);
self.onmessage=ev=>{
  const msg=ev.data;
  try{
    const reply=engine.handle(msg);
    if(reply) self.postMessage(reply,reply.I ? [reply.I.buffer] : []);
  }catch(err){
    self.postMessage({type:'error',id:msg.id,message:err?.message||String(err)});
  }
};
