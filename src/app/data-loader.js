// Static-data discovery/loading helpers extracted from app.js.

import {parseCifStructure} from "../cif/cif-structure.js";

// "no-cache" always revalidates with the server (ETag), so data are never
// stale, but an unchanged file is answered with 304 instead of re-downloading
// it on every start (the previous "no-store" bypassed the cache entirely).
export const DATA_CACHE_MODE="no-cache";

// Start a JSON download once and share it: app.js begins fetching the data
// files at start-up, and the module that needs a file later awaits the same
// request instead of starting a new one.
const jsonOnce=new Map();
export function fetchJsonOnce(url){
  if(!jsonOnce.has(url)){
    const p=fetch(url,{cache:DATA_CACHE_MODE}).then(response=>{
      if(!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
      return response.json();
    });
    p.catch(()=>{}); // a prefetch that nobody awaits must not be reported as unhandled
    jsonOnce.set(url,p);
  }
  return jsonOnce.get(url);
}

// Downloads started early by prefetchStartupData() (see src/app/prefetch.js).
// Each entry is handed to the first caller that asks for it and then removed,
// so later loads always go to the network.
const early=new Map();
function takeEarly(key){
  const p=early.get(key);
  if(p) early.delete(key);
  return p;
}
function putEarly(key,promise){
  promise.catch(()=>{}); // failures surface when the real caller awaits it
  early.set(key,promise);
  return promise;
}

export async function fetchJson(url){
  const started=takeEarly(`json:${url}`);
  if(started) return await started;
  const response = await fetch(url, {cache: DATA_CACHE_MODE});

  if(!response.ok){
    throw new Error(`${url} を読み込めませんでした (HTTP ${response.status})。`);
  }

  return await response.json();
}

export function normalizeJsonFileList(value){
  if(Array.isArray(value)){
    return value.map(String);
  }

  // Optional alternative manifest format:
  // { "files": ["a.json", "b.json"] }
  if(value && Array.isArray(value.files)){
    return value.files.map(String);
  }

  throw new Error("index.json は JSON ファイル名の配列、または {files:[...]} である必要があります。");
}

export function isGitHubPages(){ return window.location.hostname.endsWith("github.io"); }
export function isLocalDirectoryListingHost(){
  return ["localhost","127.0.0.1","::1"].includes(window.location.hostname);
}

// File lists ("manifests"): <directory>/index.json lists the data files of
// that directory, e.g. ["01_CG1B.json", "02_CG4C.json"].  On GitHub Pages it
// is read first: it is an ordinary file of the site, so it is cached and has
// no rate limit, unlike the GitHub API (60 requests per hour per IP address
// without login, shared by everyone behind the same facility or workshop
// network).  The API is only used when a directory has no index.json.
// Regenerate the lists with tools/update_data_index.py after adding or
// removing files; the local server compares them with the folder (below).
const sortNames=list=>[...new Set(list)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
async function readManifest(directory,extension){
  try{
    const response=await fetch(`${directory}/index.json`,{cache:DATA_CACHE_MODE});
    if(!response.ok) return null;
    const value=await response.json();
    const list=Array.isArray(value) ? value : (value && Array.isArray(value.files) ? value.files : null);
    if(!list) return null;
    const files=list.map(String).filter(name=>extension.test(name) && name.toLowerCase()!=="index.json");
    return files.length ? sortNames(files) : null;
  }catch(_err){ return null; }
}
// Local server only: report an index.json that no longer matches its folder,
// so an outdated list is noticed before it is pushed.
export const manifestWarnings=[];
async function checkManifestAgainstListing(directory,extension,listed){
  const response=await fetch(`${directory}/index.json`,{cache:DATA_CACHE_MODE}).catch(()=>null);
  if(!response || !response.ok){ manifestWarnings.push(`${directory}/index.json is missing`); return; }
  const manifest=await readManifest(directory,extension) || [];
  const missing=listed.filter(f=>!manifest.includes(f)), extra=manifest.filter(f=>!listed.includes(f));
  if(missing.length || extra.length){
    const msg=`${directory}/index.json is out of date`+(missing.length?` (not listed: ${missing.join(", ")})`:"")+(extra.length?` (no such file: ${extra.join(", ")})`:"");
    manifestWarnings.push(msg);
    console.warn(msg+". Run tools/update_data_index.py.");
  }
}

export async function discoverJsonFilesFromGitHub(directory){
  const owner=window.location.hostname.split('.')[0];
  const parts=window.location.pathname.split('/').filter(Boolean);
  // Organization/user Pages sites are served at /, with no repository segment.
  const repo=(!parts.length || (parts.length===1 && /\.html?$/i.test(parts[0])))
    ? `${owner}.github.io` : parts[0];
  const apiUrl=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${directory}`;
  const response=await fetch(apiUrl,{cache:DATA_CACHE_MODE,headers:{"Accept":"application/vnd.github+json"}});
  if(!response.ok) throw new Error(`GitHub API: ${directory}/ (HTTP ${response.status})`);
  const items=await response.json();
  return items.filter(x=>x&&x.type==="file").map(x=>x.name).filter(x=>/\.json$/i.test(x)&&x.toLowerCase()!=="index.json").sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
}

export async function discoverJsonFilesFromDirectoryListing(directory){
  const response = await fetch(`${directory}/`, {cache: DATA_CACHE_MODE});

  if(!response.ok){
    throw new Error(
      `${directory}/ を読み込めませんでした。` +
      ` ディレクトリがプロジェクト内にあるか確認してください。`
    );
  }

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, "text/html");

  const files = [...doc.querySelectorAll("a[href]")]
    .map(a => a.getAttribute("href"))
    .filter(Boolean)
    .map(href => {
      try{
        const url = new URL(href, window.location.href);
        return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop() || "");
      }catch(_err){
        return null;
      }
    })
    .filter(Boolean)
    .filter(name => /\.json$/i.test(name))
    .filter(name => name.toLowerCase() !== "index.json");

  return [...new Set(files)].sort((a,b)=>a.localeCompare(b));
}

async function discoverJsonFilesNow(directory){
  // Local development with python -m http.server exposes directory listings.
  if(isLocalDirectoryListingHost()){
    const files=await discoverJsonFilesFromDirectoryListing(directory);
    if(files.length===0) throw new Error(`${directory}/ に JSON ファイルを見つけられませんでした。`);
    await checkManifestAgainstListing(directory,/\.json$/i,files);
    return files;
  }

  // GitHub Pages does not expose directory listings: read index.json, and
  // ask the GitHub API only when the directory has none.
  if(isGitHubPages()){
    const listed=await readManifest(directory,/\.json$/i);
    if(listed) return listed;
    const files=await discoverJsonFilesFromGitHub(directory);
    if(files.length===0) throw new Error(`${directory}/ に JSON ファイルがありません。`);
    return files;
  }

  // Other static hosts may provide an explicit manifest.
  try{
    const manifestResponse=await fetch(`${directory}/index.json`,{cache:DATA_CACHE_MODE});
    if(manifestResponse.ok){
      const manifest=await manifestResponse.json();
      const files=normalizeJsonFileList(manifest)
        .filter(name=>/\.json$/i.test(name))
        .filter(name=>name.toLowerCase()!=="index.json");
      if(files.length>0) return files.sort((a,b)=>a.localeCompare(b));
    }
  }catch(_err){}

  const files=await discoverJsonFilesFromDirectoryListing(directory);
  if(files.length===0) throw new Error(`${directory}/ に JSON ファイルを見つけられませんでした。`);
  return files;
}

export function discoverJsonFiles(directory){
  return takeEarly(`dir-json:${directory}`) || discoverJsonFilesNow(directory);
}

export async function loadJsonDirectory(directory, targetMap){
  targetMap.clear();

  const files = await discoverJsonFiles(directory);

  // Download all files in parallel; insert in the original (sorted) order.
  const objects = await Promise.all(files.map(filename=>fetchJson(`${directory}/${filename}`)));
  files.forEach((filename,i)=>{
    targetMap.set(filename.replace(/\.json$/i, ""), objects[i]);
  });

  return files.length;
}

export function normalizeCifFileList(value){
  if(Array.isArray(value)) return value.map(String);
  if(value && Array.isArray(value.files)) return value.files.map(String);
  throw new Error("BG_material/index.json must be an array of CIF filenames or {files:[...]}. ");
}

export async function discoverCifFilesFromGitHub(directory){
  const owner=window.location.hostname.split('.')[0];
  const parts=window.location.pathname.split('/').filter(Boolean);
  // Organization/user Pages sites are served at /, with no repository segment.
  const repo=(!parts.length || (parts.length===1 && /\.html?$/i.test(parts[0])))
    ? `${owner}.github.io` : parts[0];
  const apiUrl=`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${directory}`;
  const response=await fetch(apiUrl,{cache:DATA_CACHE_MODE,headers:{"Accept":"application/vnd.github+json"}});
  if(!response.ok) throw new Error(`GitHub API: ${directory}/ (HTTP ${response.status})`);
  const items=await response.json();
  return items
    .filter(x=>x&&x.type==="file")
    .map(x=>x.name)
    .filter(x=>/\.cif$/i.test(x))
    .sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
}

export async function discoverCifFilesFromDirectoryListing(directory){
  const response=await fetch(`${directory}/`,{cache:DATA_CACHE_MODE});
  if(!response.ok) throw new Error(`${directory}/ could not be loaded (HTTP ${response.status}).`);
  const html=await response.text();
  const doc=new DOMParser().parseFromString(html,"text/html");
  const files=[...doc.querySelectorAll("a[href]")]
    .map(a=>a.getAttribute("href"))
    .filter(Boolean)
    .map(href=>{
      try{
        const url=new URL(href,window.location.href);
        return decodeURIComponent(url.pathname.split("/").filter(Boolean).pop()||"");
      }catch(_err){ return null; }
    })
    .filter(Boolean)
    .filter(name=>/\.cif$/i.test(name));
  return [...new Set(files)].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
}

async function discoverCifFilesNow(directory){
  // On the local Python server, the directory listing is authoritative.
  if(isLocalDirectoryListingHost()){
    const files=await discoverCifFilesFromDirectoryListing(directory);
    await checkManifestAgainstListing(directory,/\.cif$/i,files);
    return files;
  }

  // On GitHub Pages read index.json; the GitHub API is only the fallback.
  if(isGitHubPages()){
    const listed=await readManifest(directory,/\.cif$/i);
    if(listed) return listed;
    return await discoverCifFilesFromGitHub(directory);
  }

  // Optional manifest for other static hosts that do not expose listings.
  try{
    const response=await fetch(`${directory}/index.json`,{cache:DATA_CACHE_MODE});
    if(response.ok){
      const manifest=await response.json();
      const files=normalizeCifFileList(manifest).filter(name=>/\.cif$/i.test(name));
      if(files.length) return files.sort((a,b)=>a.localeCompare(b,undefined,{numeric:true,sensitivity:"base"}));
    }
  }catch(_err){}

  return await discoverCifFilesFromDirectoryListing(directory);
}

export function discoverCifFiles(directory){
  return takeEarly(`dir-cif:${directory}`) || discoverCifFilesNow(directory);
}

function fetchCifText(url){
  return takeEarly(`text:${url}`) || fetch(url,{cache:DATA_CACHE_MODE}).then(async response=>{
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.text();
  });
}

// `beforeParse` (optional promise) is awaited after the downloads and before
// parsing: CIF parsing reads neutron scattering lengths, so the caller passes
// the neutron-data load to let downloads overlap with it.
export async function loadCifDirectory(directory,targetMap,{beforeParse=null}={}){
  targetMap.clear();
  const files=await discoverCifFiles(directory);
  const errors=[];
  const texts=await Promise.all(files.map(async filename=>{
    try{ return {text:await fetchCifText(`${directory}/${filename}`)}; }
    catch(err){ return {err}; }
  }));
  if(beforeParse) await Promise.resolve(beforeParse).catch(()=>{});
  files.forEach((filename,i)=>{
    try{
      if(texts[i].err) throw texts[i].err;
      const structure=parseCifStructure(texts[i].text);
      const key=filename.replace(/\.cif$/i,"");
      targetMap.set(key,{key,filename,structure});
    }catch(err){
      errors.push(`${filename}: ${err?.message||err}`);
    }
  });
  if(errors.length) console.warn("BG_material CIF load warning(s):\n"+errors.join("\n"));
  return targetMap.size;
}

// Start the start-up data downloads immediately (called by src/app/prefetch.js
// before Plotly and the application have even been evaluated). app.js later
// asks for the same files through the normal functions above and receives
// these in-flight requests instead of starting new ones.
export function prefetchStartupData(){
  fetchJsonOnce('neutron-data.json');
  fetchJsonOnce('space-groups.json');
  for(const directory of ['instrument','sample_environments']){
    const files=putEarly(`dir-json:${directory}`,discoverJsonFilesNow(directory));
    files.then(list=>{
      for(const name of list){
        const url=`${directory}/${name}`;
        putEarly(`json:${url}`,fetch(url,{cache:DATA_CACHE_MODE}).then(async response=>{
          if(!response.ok) throw new Error(`${url} を読み込めませんでした (HTTP ${response.status})。`);
          return await response.json();
        }));
      }
    },()=>{});
  }
  const cif=putEarly('dir-cif:BG_material',discoverCifFilesNow('BG_material'));
  cif.then(list=>{
    for(const name of list){
      const url=`BG_material/${name}`;
      putEarly(`text:${url}`,fetch(url,{cache:DATA_CACHE_MODE}).then(async response=>{
        if(!response.ok) throw new Error(`HTTP ${response.status}`);
        return await response.text();
      }));
    }
  },()=>{});
}
