// Fixed-beam display conversion: preserve the established internal meV model.
// E [meV] = 81.8042 / lambda [Angstrom]^2; k [Angstrom^-1] = 2 PI / lambda.
const ENERGY_LAMBDA_CONSTANT = 81.8042;
const SIDE = {Ei:'i',Ef:'f',lambda_i:'i',lambda_f:'f',ki:'i',kf:'f'};
const LABEL = {Ei:'Ei (meV)',Ef:'Ef (meV)',lambda_i:'λi (Å)',lambda_f:'λf (Å)',ki:'ki (Å⁻¹)',kf:'kf (Å⁻¹)'};

export function energyFromFixedBeam(quantity,value){
  const x=Number(value);
  if(!(x>0) || !Number.isFinite(x) || !Object.hasOwn(SIDE,quantity)) return NaN;
  if(quantity==='Ei'||quantity==='Ef') return x;
  if(quantity.startsWith('lambda_')) return ENERGY_LAMBDA_CONSTANT/(x*x);
  const lambda=2*Math.PI/x;
  return ENERGY_LAMBDA_CONSTANT/(lambda*lambda);
}
export function fixedBeamFromEnergy(quantity,energyMeV){
  const e=Number(energyMeV);
  if(!(e>0) || !Number.isFinite(e) || !Object.hasOwn(SIDE,quantity)) return NaN;
  if(quantity==='Ei'||quantity==='Ef') return e;
  const lambda=Math.sqrt(ENERGY_LAMBDA_CONSTANT/e);
  return quantity.startsWith('lambda_') ? lambda : 2*Math.PI/lambda;
}
export function canonicalModeFromFixedBeam(quantity){
  return SIDE[quantity]==='i' ? 'Ei fixed' : 'Ef fixed';
}

function displayNumber(value){
  // Keep the canonical meV value sufficiently precise for calculations.
  return Number(value.toPrecision(10)).toString();
}
function displayFixedValue(value){
  // Only the visible Fixed entry is rounded; never round the canonical meV state.
  return Number(value.toFixed(3)).toString();
}

export function createFixedBeamControls(doc=document){
  const get=id=>doc.getElementById(id);
  const quantity=get('fixedBeamQuantity'), field=get('fixedBeamValue'), label=get('fixedBeamLabelText');
  const canonicalMode=get('energyMode'), canonicalEnergy=get('energy');
  if(!quantity||!field||!label||!canonicalMode||!canonicalEnergy) return null;
  let writing=false;
  const currentSide=()=>canonicalMode.value==='Ei fixed'?'i':'f';
  const coerceQuantity=q=>(Object.hasOwn(SIDE,q)?q:(currentSide()==='i'?'Ei':'Ef'));

  function syncFromCanonical({preferredQuantity=null}={}){
    if(writing) return;
    let q=coerceQuantity(preferredQuantity || quantity.value);
    if(SIDE[q]!==currentSide()) q=(q==='lambda_i'||q==='lambda_f') ? `lambda_${currentSide()}` : (q==='ki'||q==='kf') ? `k${currentSide()}` : currentSide()==='i'?'Ei':'Ef';
    quantity.value=q;
    label.textContent=LABEL[q];
    const energy=Number(canonicalEnergy.value);
    if(energy>0 && Number.isFinite(energy)) field.value=displayFixedValue(fixedBeamFromEnergy(q,energy));
  }

  function updateCanonical(eventType){
    const q=coerceQuantity(quantity.value);
    label.textContent=LABEL[q];
    const raw=field.value;
    if(!raw.trim()){field.setCustomValidity('Enter a positive value.');return false;}
    const energy=energyFromFixedBeam(q,raw);
    if(!(energy>0) || !Number.isFinite(energy)){
      field.setCustomValidity('A finite positive value is required.');return false;
    }
    field.setCustomValidity('');
    writing=true;
    try{
      const mode=canonicalModeFromFixedBeam(q);
      const modeChanged=canonicalMode.value!==mode;
      canonicalMode.value=mode;
      canonicalEnergy.value=displayNumber(energy);
      // Existing modules receive exactly the same events as before.
      if(modeChanged) canonicalMode.dispatchEvent(new Event('change',{bubbles:true}));
      canonicalEnergy.dispatchEvent(new Event(eventType,{bubbles:true}));
    }finally{writing=false;}
    return true;
  }

  quantity.addEventListener('change',()=>{
    const q=coerceQuantity(quantity.value);
    // A unit switch must not re-parse the 3-decimal display value: doing so
    // would change the physical energy after repeated unit switches.
    const mode=canonicalModeFromFixedBeam(q);
    if(canonicalMode.value!==mode){
      canonicalMode.value=mode;
      canonicalMode.dispatchEvent(new Event('change',{bubbles:true}));
    }
    syncFromCanonical({preferredQuantity:q});
    canonicalEnergy.dispatchEvent(new Event('change',{bubbles:true}));
  });
  field.addEventListener('input',()=>updateCanonical('input'));
  field.addEventListener('change',()=>{
    if(updateCanonical('change')) syncFromCanonical();
  });
  for(const source of [canonicalMode,canonicalEnergy]){
    source.addEventListener('change',()=>syncFromCanonical());
    source.addEventListener('input',()=>{ if(doc.activeElement!==field) syncFromCanonical(); });
  }
  syncFromCanonical();
  return {syncFromCanonical};
}
