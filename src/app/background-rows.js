// Sidebar background-scattering material rows (slots, colours, add/remove).
// Extracted from app.js without changing calculation/display behavior; dependencies are injected by app.js.
export function createBackgroundRows(deps){
  const {
    $, backgroundMaterials, refreshBackgroundSelect, saveLeftPanelState, scheduleRecalc
  }=deps;

// Background-scattering slots are dynamic. Preserve the original first four
// colors, then continue through a high-contrast palette and generated hues.
const BACKGROUND_COLOR_PALETTE=[
  [0,0,128],      // navy
  [165,42,42],    // brown
  [44,160,44],    // green
  [148,103,189],  // purple
  [255,127,14],   // orange
  [23,190,207],   // cyan
  [214,39,40],    // red
  [188,189,34],   // olive
  [227,119,194],  // pink
  [127,127,127],  // gray
  [31,119,180],   // blue
  [140,86,75]     // muted brown
];
const BACKGROUND_SLOTS=[];
function backgroundRgbForIndex(index){
  const i=Math.max(1,Math.floor(Number(index)||1));
  if(i<=BACKGROUND_COLOR_PALETTE.length) return BACKGROUND_COLOR_PALETTE[i-1].slice();
  // Golden-angle hue stepping keeps later backgrounds visually separated.
  const h=((i-BACKGROUND_COLOR_PALETTE.length)*137.508)%360;
  const c=0.62, l=0.48, hp=h/60, x=c*(1-Math.abs((hp%2)-1));
  let r=0,g=0,b=0;
  if(hp<1){r=c;g=x;} else if(hp<2){r=x;g=c;} else if(hp<3){g=c;b=x;}
  else if(hp<4){g=x;b=c;} else if(hp<5){r=x;b=c;} else {r=c;b=x;}
  const m=l-c/2;
  return [r,g,b].map(v=>Math.round((v+m)*255));
}
function backgroundSlot(index){
  const i=Math.max(1,Math.floor(Number(index)||1));
  while(BACKGROUND_SLOTS.length<i){
    const n=BACKGROUND_SLOTS.length+1;
    BACKGROUND_SLOTS.push({id:`backgroundSelect${n}`,rgb:backgroundRgbForIndex(n)});
  }
  return BACKGROUND_SLOTS[i-1];
}
for(let i=1;i<=4;i++) backgroundSlot(i);
function selectedBackgrounds(){
  return BACKGROUND_SLOTS.map((slot,index)=>({slot,index,key:$(slot.id)?.value||""}))
    .filter(x=>x.key && backgroundMaterials.has(x.key));
}

function updateBackgroundSelectAvailability(){
  const chosen=new Map();
  for(const slot of BACKGROUND_SLOTS){
    const sel=$(slot.id);
    if(sel?.value) chosen.set(slot.id,sel.value);
  }
  for(const slot of BACKGROUND_SLOTS){
    const sel=$(slot.id);
    if(!sel) continue;
    for(const opt of sel.options){
      if(!opt.value){ opt.disabled=false; opt.hidden=false; continue; }
      const usedElsewhere=[...chosen.entries()].some(([id,key])=>id!==slot.id && key===opt.value);
      opt.disabled=usedElsewhere;
      opt.hidden=usedElsewhere;
    }
  }
}

function handleBackgroundSelection(changedId){
  const changed=$(changedId);
  if(!changed) return;
  const key=changed.value;
  if(key){
    // The most recently changed slot owns the selection.  This is mainly a
    // safeguard for restored/legacy states; normally duplicates are hidden.
    for(const slot of BACKGROUND_SLOTS){
      if(slot.id!==changedId && $(slot.id)?.value===key) $(slot.id).value="";
    }
  }
  updateBackgroundSelectAvailability();
  saveLeftPanelState();
  scheduleRecalc();
}

function backgroundRowIndices(){
  return [...document.querySelectorAll(".background-row[data-background-index]")]
    .map(row=>Number(row.dataset.backgroundIndex))
    .filter(Number.isFinite)
    .sort((a,b)=>a-b);
}

// Colors: each row starts with the default of its position (the palette
// above); clicking the square changes it, and a changed color is saved with
// the row (it follows the material when rows above are removed).
const rgbToHex=rgb=>'#'+rgb.map(v=>Math.max(0,Math.min(255,Math.round(v))).toString(16).padStart(2,'0')).join('');
const hexToRgb=hex=>{
  const m=/^#?([0-9a-f]{6})$/i.exec(String(hex||'').trim());
  return m ? [0,2,4].map(i=>parseInt(m[1].slice(i,i+2),16)) : null;
};
function backgroundRowValues(){
  return backgroundRowIndices().map(index=>{
    const value={key:$(`backgroundSelect${index}`)?.value||""};
    const color=rgbToHex(backgroundSlot(index).rgb);
    if(color!==rgbToHex(backgroundRgbForIndex(index))) value.color=color;
    return value;
  });
}

function createBackgroundRow(index,value={}){
  const slot=backgroundSlot(index);
  slot.rgb=hexToRgb(value.color) || backgroundRgbForIndex(index);
  const row=document.createElement("div");
  row.className="background-row";
  row.dataset.backgroundIndex=String(index);
  // One row of the table under the No. / Material header.
  row.innerHTML=`<span class="background-label">BG${index}</span><input type="color" class="bg-swatch" id="backgroundColor${index}" title="BG${index} color" aria-label="BG${index} color"><select id="backgroundSelect${index}" aria-label="BG${index} material"><option value="">None</option></select>`+
    `<button type="button" class="remove-background" data-background-index="${index}">Remove</button>`;
  const picker=row.querySelector(`#backgroundColor${index}`);
  picker.value=rgbToHex(slot.rgb);
  picker.addEventListener("input",()=>{
    const rgb=hexToRgb(picker.value);
    if(!rgb) return;
    slot.rgb=rgb;
    scheduleRecalc();
  });
  picker.addEventListener("change",()=>saveLeftPanelState());
  const select=row.querySelector(`#backgroundSelect${index}`);
  // No "None": a row always has a material (Remove deletes the row).
  refreshBackgroundSelect(select,null);
  const requested=String(value.key||"");
  if([...select.options].some(o=>o.value===requested)) select.value=requested;
  return row;
}

function replaceBackgroundRows(values,{recalc=false}={}){
  const host=$("backgroundRows");
  if(!host) return;
  // The table may be empty (no background material).
  const rows=Array.isArray(values)?values:[];
  backgroundSlot(Math.max(1,rows.length));
  host.replaceChildren();
  rows.forEach((value,i)=>{
    const row=createBackgroundRow(i+1,value);
    if(row) host.appendChild(row);
  });
  if($("backgroundCount")) $("backgroundCount").value=String(rows.length);
  updateBackgroundSelectAvailability();
  // Each material can be used once.
  const add=$("addBackground");
  if(add) add.disabled=backgroundMaterials.size>0 && rows.length>=backgroundMaterials.size;
  if(recalc) scheduleRecalc();
}

function setBackgroundCount(count,{recalc=false}={}){
  count=Math.max(0,Math.floor(Number(count)||0));
  backgroundSlot(Math.max(1,count));
  const values=backgroundRowValues();
  while(values.length<count) values.push({});
  values.length=count;
  replaceBackgroundRows(values,{recalc});
}

function removeBackground(index){
  const values=backgroundRowValues();
  const position=backgroundRowIndices().indexOf(Number(index));
  if(position>=0) values.splice(position,1);
  replaceBackgroundRows(values,{recalc:true});
  saveLeftPanelState();
}
function backgroundColor(slot,alpha=1){
  const [r,g,b]=slot.rgb; return `rgba(${r},${g},${b},${alpha})`;
}

  return {
    BACKGROUND_SLOTS, backgroundColor, backgroundRowIndices, backgroundRowValues,
    handleBackgroundSelection, removeBackground, replaceBackgroundRows, selectedBackgrounds,
    setBackgroundCount, updateBackgroundSelectAvailability
  };
}
