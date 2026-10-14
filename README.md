# PLANE-TAS

**Planning Experiments with a Triple-Axis Spectrometer**

PLANE-TAS is a browser-based tool for planning neutron triple-axis spectrometer (TAS) experiments. It brings together accessible momentum–energy ranges, scattering geometry, instrumental resolution, crystal-structure visualization, and measurement scripting.

**Web application:** https://plane-tas.github.io/  
**Source code:** https://github.com/plane-tas/plane-tas.github.io

## Features

### Q–E Range and TAS geometry

- Accessible Q–E maps for single-crystal and powder experiments.
- Constant-energy reciprocal-space maps and Q vector–E maps.
- Instrument configuration, fixed Ei/Ef, scattering plane and sample orientation.
- Angle calculation and TAS geometry for a single point or scan trajectory.
- Background-scattering and Dark-angle overlays, with relevant geometry and reachability warnings.
- Propagation-vector display and configurable scattering-plane references.

### Resolution

- TAS resolution calculations using instrument parameters from configuration JSON files.
- Single-point and scan calculations, including resolution plots and matrices.

### Structure editor and reflections

- Load and visualize CIF and mCIF structure files.
- Edit cell parameters, atomic positions, spin vectors, atom appearance, and bonds.
- Visualize nuclear structures and spins from imported magnetic structures.
- Calculate and sort **nuclear** Bragg reflections; inspect structure-file previews.
- Generate, download and set **CIF** and experimental **mCIF** output.

**Experimental magnetic-structure features and limitations:**

- **mCIF export is available** for single-k magnetic structures using a magnetic P1 representation. It creates a finite commensurate supercell and can use a rational approximation to the entered propagation vector. Such output is **not** an exact incommensurate superspace description or an automatically validated BNS classification. Check the generated mCIF before using it in quantitative work.
- Imported mCIF files with explicitly provided magnetic symmetry operations can be visualized; incommensurate single-q Fourier support is limited to recognized superspace operations. Multi-q magnetic structures are not supported.
- **Magnetic reflection intensity calculations** remain disabled in the public interface pending external validation.

### Script and time estimate

- Create measurement sequences and SPICE macros.
- Convert between command tables and SPICE text explicitly using the corresponding conversion controls.
- ASET templates, loops, scans, MCU-based time estimates, and reachability diagnostics.

### Toolbox

- Neutron unit conversion and wavelength harmonics.
- X-ray-to-neutron S2 conversion.
- Neutron attenuation calculations using sample composition and beam energy.
- Magnetic form-factor visualization and data export (separate from the disabled magnetic-reflection calculation).

## TAS geometry and sign conventions

Geometry calculations use the selected instrument configuration and the sign/geometry conventions defined in the numerical modules. **Instrument-specific configurations should be verified against the actual spectrometer before measurement.** This README deliberately does not document legacy sign-code mappings that no longer describe the intended user workflow.

## Code organization

The browser application uses ES modules, with responsibilities separated across files including:

| File | Responsibility |
| --- | --- |
| `index.html`, `styles.css` | Application interface and responsive layout |
| `app.js`, `app-bootstrap.js`, `app-runtime.js` | Application integration and calculation/event flow |
| `ui-shell.js`, `sidebar-dynamic-ui.js` | Tab, panel and dynamic-interface behavior |
| `data-loader.js`, `instrument-config.js` | Static project data and instrument configurations |
| `tas-core.js`, `tas-conventions.js`, `tas-angle-calculation.js`, `tas-geometry-view.js` | Reciprocal-space/TAS geometry and instrument conventions |
| `qe-plot.js`, `qe-single-crystal.js`, `powder-qe.js`, `dark-angle.js` | Q–E display, scattering accessibility and overlays |
| `resolution-core.js`, `resolution-ui.js`, `matrix.js` | Resolution calculations and display |
| `cif-ui.js`, `cif-structure.js`, `cif-symmetry.js` | CIF/mCIF input, Structure editor and nuclear reflections |
| `mcif-export.js`, `magnetic-reflections.js` | Experimental mCIF export; magnetic-reflection calculation disabled in public interface |
| `magnetic-form-factor.js`, `magnetic-form-factor-data.js` | Magnetic-ion form-factor calculation and coefficients |
| `script-workspace.js`, `script-ui.js` | Measurement scripts, SPICE and time estimates |
| `toolbox.js`, `toolbox-ui.js` | Unit conversion, attenuation and form-factor toolbox |

Instrument definitions and other optional static data live in project directories such as `instrument/`, `BG_material/` and `sample_environments/`, where provided.

## User manual

Read the **[PLANE-TAS User Manual](https://plane-tas.github.io/PLANE-TAS_Manual.html)** online, or view the [`PLANE-TAS_Manual.html`](PLANE-TAS_Manual.html) source file in this repository.

The manual includes illustrations; if an interface detail differs from the current application, follow the live application.

## Data and validation

PLANE-TAS is a planning and simulation tool. Before executing an experiment, confirm motor conventions, instrument limits, sample orientation and generated scripts on the actual instrument. Magnetic-symmetry identification and magnetic-reflection intensity results should not be used as validated outputs in the current public release.
