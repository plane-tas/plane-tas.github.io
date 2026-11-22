// Neutron energy and wavelength: E [meV] = 81.8042 / λ [Å]², used by every
// part of PLANE-TAS that converts between them (k = 2π/λ).
export const E_LAMBDA=81.8042;
export const energyFromWavelength=lambda=>E_LAMBDA/(lambda*lambda);
export const wavelengthFromEnergy=energy=>Math.sqrt(E_LAMBDA/energy);
