# PLANE-TAS

**Planning Experiments with a Triple-Axis Spectrometer**

PLANE-TAS is a browser-based tool for planning neutron triple-axis spectrometer (TAS) experiments. It brings together accessible momentum–energy ranges, scattering geometry, instrumental resolution, crystal-structure visualization, and measurement scripting.

**Web application:** https://plane-tas.github.io/  
**Source code:** https://github.com/plane-tas/plane-tas.github.io

## Features

### Q–E Range and TAS geometry

- Accessible Q–E maps for single-crystal and powder samples, within the instrument's S1/S2 limits.
- **Constant E map** (reciprocal-space slice in r.l.u. along the entered U and V) and **Q vector–E map** along an HKL path, sharing one clickable legend.
- Nuclear Bragg peaks (shaded by |F<sub>N</sub>|² when a CIF/mCIF is loaded) and magnetic-peak positions for one or more propagation vectors; hover labels give (h,k,l), |Q|, S1 and S2.
- Q paths selected by clicking on the Constant E map or typed as HKL points, with Snap 1/n (default 1/4, or 1/6 for lattices with 60° or 120° angles; empty = free).
- **Angle calculation & TAS geometry**: motor angles and an instrument drawing for one (h,k,l,ħω) target, with ħω, U, V and c1·U + c2·V sliders. The target is shown on the Constant E map and can be dragged there; its ħω is synchronized with the map's energy slice.
- Background powder rings, Dark-angle (sample-environment) overlays, and spurion warnings limited to higher-order combinations the instrument can deliver.
- Warnings for points outside the scattering plane or the motor limits, unreachable points, dark angles and spurions.
- The Q–E Range and Script tabs fit the visible browser height on desktop layouts.

### Resolution

- TAS resolution (Cooper–Nathans or Popovici) using instrument parameters from configuration JSON files.
- Single-point and scan calculations, with projected and sliced resolution ellipses, widths and resolution matrices.
- Popovici uses component sizes in cm (distances in m), converted to second moments as in Popovici (1975) (rectangle A²/12, circle/cylinder D²/16); the source is a rectangle or circle, the detector a rectangle or cylinder, and the sample a cylinder (diameter, height).
- Not available for diffractometer presets.

### Structure editor and reflections

- Load and visualize CIF and mCIF structure files. The file selected in the sidebar and in the CIF/mCIF Generator is the same.
- Edit cell parameters, atomic positions (with Biso/Uij), spin vectors, atom appearance, bonds, and polyhedral display settings.
- Separate **Crystallographic** and **Magnetic** unit-cell fields for imported mCIF structures when available. Structure's Min/Max coordinates refer to the selected unit cell.
- In the Spins editor, **Symmetry operations** shows independent magnetic sites and **Manual** shows the expanded magnetic sites; nonmagnetic atoms remain in the structure.
- **Nuclear and magnetic Bragg reflections** as a table or graph: |F<sub>N</sub>|², |F<sub>M</sub>|², magnetic form factor, Lorentz factor, multiplicity, 2θ, Q and d. Magnetic intensities use the dipole approximation and a single magnetic domain, with the same Debye–Waller factor as the nuclear calculation; absorption, extinction and instrument corrections are not included.
- Generate, preview, download and set **CIF** and **mCIF** output.

**Magnetic-structure scope and limitations:**

- **Single-k, commensurate structures only.** The propagation vector must be an exact fraction with denominator at most 24 (enter `1/3`, not `0.33`).
- **Incommensurate and multi-k magnetic structures are not supported** for magnetic reflections or mCIF export. An incommensurate single-k mCIF can still be loaded to view the structure and to calculate nuclear reflections. Additional propagation vectors in the sidebar only mark magnetic-peak positions on the Q–E maps.
- **mCIF output is always written in magnetic space group P1** (a commensurate supercell with all moments listed). The magnetic space group (BNS) is not identified.
- Moments of a loaded mCIF can be edited while keeping the magnetic symmetry given in the file. This is distinct from generating a new P1 mCIF.
- For an imported mCIF, the parent crystallographic cell is reconstructed from explicit cell-transformation data where possible. If a diagonal candidate is independently verified from atomic translations and k, it is labeled **Estimated** and nuclear peaks use the estimated structure. If a reliable parent cannot be determined, nuclear reflections are not calculated; a parent cell is **not** deduced from BNS alone.

### Script and time estimate

- Command lists (drive, driverel, scan, scanrel, scantitle, count, wait, loops) shared between the Script tab and Q–E Range → Time estimate.
- Explicit conversion between command lists and SPICE macro text.
- ASET templates for auxiliary devices (temperature, field, …) in a collapsible drawer.
- MCU-based time estimates (Calc finish / Calc MCU) and per-command warnings for motor limits, reachability, scattering plane and dark angles.

### Toolbox

- Neutron unit conversion and wavelength harmonics.
- X-ray-to-neutron S2 conversion.
- Neutron attenuation calculations from a chemical formula and density or a CIF/mCIF.
- Magnetic form-factor curves and data export.

## Browser data and recovery

- User-edited structure, spin and display settings are stored in the browser. Use **Reload current file** to discard edits and re-read the original CIF/mCIF. Keep a separate copy of important input files.
- If the application cannot recover after an interrupted rendering session, reopen the application URL with `?tas-safe-reset=1` appended (or `&tas-safe-reset=1` if the URL already contains a query). This clears the application's saved `tas-` settings and can discard unsaved edits. Then reopen the normal URL and reload the CIF/mCIF as needed.
- If that does not help, open your browser's Developer Tools → **Application/Storage** → **Local Storage** and **Session Storage** for the PLANE-TAS page, remove keys beginning with `tas-`, then reload. Do **not** clear unrelated sites' storage.

## TAS geometry and sign conventions

Geometry calculations use the selected instrument configuration and the sign/geometry conventions defined in the numerical modules. **Instrument-specific configurations should be verified against the actual spectrometer before measurement.** This README deliberately does not document legacy sign-code mappings that no longer describe the intended user workflow.

## Code organization

The browser application uses plain ES modules (no build step). All code lives in `src/`; `index.html` loads `src/app.js`.

| Path | Responsibility |
| --- | --- |
| `index.html`, `styles/*.css` | Application interface and responsive layout. Stylesheets are linked in numeric order; the order is significant. |
| `src/app.js` | Entry point: creates the feature modules, wires their dependencies, restores saved settings and runs the first calculation |
| `src/app/` | Shared application UI: tabs and saved settings (`ui-shell.js`), data loading, fixed-beam units, sidebar rows, instrument setup, recalculation scheduling |
| `src/core/` | Reciprocal-space/TAS geometry, instrument conventions, angle calculation and matrix helpers |
| `src/qe/` | Q–E Range: single-crystal and powder maps, Q-vector map and path, dark-angle overlays |
| `src/geometry/` | TAS geometry view, quick geometry targets and target sliders |
| `src/resolution/` | Resolution calculations and display |
| `src/cif/` | CIF/mCIF parsing, symmetry, nuclear structure factors and mCIF export; `cif-ui.js` installs the Structure editor parts in `src/cif/ui/` |
| `src/magnetic/` | Magnetic reflections and magnetic form factors |
| `src/toolbox/` | Unit conversion, S2 conversion, attenuation and form-factor toolbox |
| `src/script/` | Measurement scripts, SPICE and time estimates |

Static data stays at the project root because it is loaded by path: `instrument/`, `BG_material/`, `sample_environments/`, `neutron-data.json` and `space-groups.json`.

## User manual

Read the **[PLANE-TAS User Manual](https://plane-tas.github.io/PLANE-TAS_Manual.html)** online, or view the [`PLANE-TAS_Manual.html`](PLANE-TAS_Manual.html) source file in this repository.

The manual includes illustrations; if an interface detail differs from the current application, follow the live application.

## Data and validation

PLANE-TAS is a planning and simulation tool. Before executing an experiment, confirm motor conventions, instrument limits, sample orientation and generated scripts on the actual instrument. Magnetic-reflection intensities are model calculations under the approximations listed above, and generated mCIF files do not identify the magnetic space group; review them before quantitative use.
