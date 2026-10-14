// Loaded with <script type="module" async>: runs as soon as it arrives, without
// waiting for Plotly or for the HTML to finish parsing, and starts downloading
// the start-up data (instrument / BG material / sample-environment files,
// neutron data and space groups). src/app.js picks up the same requests.
import {prefetchStartupData} from './data-loader.js';

try{ prefetchStartupData(); }catch(err){ console.warn('Start-up data prefetch skipped:',err); }
