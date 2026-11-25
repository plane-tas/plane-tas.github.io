// Resolution › Convolution: constants shared by its parts.
import {PLOT_FONTS} from '../core/plot-fonts.js';

export const ROW_HEIGHT=22;
export const NOTE='Intensities are S(Q,ω); R0/Rmon (normalisation to monitor counts) is applied automatically.';
// Plotly sizes are scaled by the UI density (about 0.67 on a laptop).
export const FONT={size:PLOT_FONTS.tick}, AXIS_TITLE_FONT={size:PLOT_FONTS.axis};
// 2D map titles: one fixed size for every condition (see drawMaps).
export const CONV_TITLE_SIZE=18;
export const MAX_TABLE_RANGE_POINTS={ab:101,E:301};
