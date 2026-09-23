"""Combined VAT: parameters and layer order transcribed from RVT's own
`VAT_Combined.rft.xml`, with `rvt.vis` and `rvt.blend_func` doing the work.

`rvt.blend.BlenderCombination` would hold the order too, but importing it pulls
in `osgeo.gdal`. Radii are RVT's, stated in pixels against a 0.5 m DEM.
"""

import numpy as np
from rvt.blend_func import blend_images, normalize_image, render_images
from rvt.vis import byte_scale, hillshade, sky_view_factor, slope_aspect

# byte_scale is re-exported so the writer quantises with RVT's rule: 0..1 -> 0..255,
# NaN -> 255.
__all__ = ["VAT_PRESETS", "byte_scale", "cvat", "radii_for"]

# VAT_general.rft.xml and VAT_flat.rft.xml, verbatim.
VAT_PRESETS = {
    "general": {
        "sun_elevation": 35,
        "svf_r_max": 10,
        "svf_noise": 0,
        "slope": (0.0, 50.0),
        "opns": (68.0, 93.0),
        "svf": (0.7, 1.0),
    },
    "flat": {
        "sun_elevation": 15,
        "svf_r_max": 20,
        "svf_noise": 3,
        "slope": (0.0, 15.0),
        "opns": (85.0, 93.0),
        "svf": (0.9, 1.0),
    },
}

SUN_AZIMUTH = 315
N_DIRECTIONS = 16
VE_FACTOR = 1
# VAT_Combined.rft.xml: general over flat, normal, 50 %.
COMBINED_OPACITY = 50
# The resolution RVT's pixel radii were calibrated at.
CALIBRATION_M_PER_PX = 0.5


def _stack(dem, resolution, preset, radius_scale):
    """One VAT preset -> 0..1. Layers are listed bottom-first, as RVT orders them."""
    r_max = max(1, int(round(preset["svf_r_max"] * radius_scale)))
    horizon = sky_view_factor(
        dem,
        resolution=resolution,
        compute_svf=True,
        compute_opns=True,
        svf_n_dir=N_DIRECTIONS,
        svf_r_max=r_max,
        svf_noise=preset["svf_noise"],
        ve_factor=VE_FACTOR,
    )
    slope = slope_aspect(
        dem,
        resolution_x=resolution,
        resolution_y=resolution,
        output_units="degree",
        ve_factor=VE_FACTOR,
    )["slope"]
    layers = [
        ("Hillshade", hillshade(dem, resolution, resolution,
                                sun_azimuth=SUN_AZIMUTH,
                                sun_elevation=preset["sun_elevation"],
                                ve_factor=VE_FACTOR),
         (0.0, 1.0), "normal", 100),
        ("Slope gradient", slope, preset["slope"], "luminosity", 50),
        ("Openness - positive", horizon["opns"], preset["opns"], "overlay", 50),
        ("Sky-View Factor", horizon["svf"], preset["svf"], "multiply", 25),
    ]

    rendered = None
    for vis, image, (lo, hi), mode, opacity in layers:
        norm = normalize_image(vis, image, lo, hi, "value")
        if rendered is None:
            rendered = norm
            continue
        # RVT quirk, reproduced: blend_overlay writes through `background`, so on
        # the openness layer `top` and `background` alias and its 50 % does nothing.
        top = blend_images(mode, norm, rendered)
        rendered = render_images(top, rendered, opacity)
    return rendered


def cvat(dem, resolution, radius_in_metres=True):
    """Combined VAT as a float array in 0..1. NaN where the DEM has none.

    `radius_in_metres` scales RVT's pixel radii to hold the 0.5 m reach in metres;
    False uses them as written."""
    scale = CALIBRATION_M_PER_PX / resolution if radius_in_metres else 1.0
    general = _stack(dem, resolution, VAT_PRESETS["general"], scale)
    flat = _stack(dem, resolution, VAT_PRESETS["flat"], scale)
    return render_images(blend_images("normal", general, flat), flat,
                         COMBINED_OPACITY)


def radii_for(resolution, radius_in_metres=True):
    """(r_max, r_min) in pixels and metres, per preset, for the manifest."""
    scale = CALIBRATION_M_PER_PX / resolution if radius_in_metres else 1.0
    # svf_noise is a level 0-3; rvt.vis.sky_view_factor maps it to r_min as a
    # percentage of r_max via sc_svf_r_min.
    r_min_pct = (0.0, 10.0, 20.0, 40.0)
    out = {}
    for name, preset in VAT_PRESETS.items():
        r_max = max(1, int(round(preset["svf_r_max"] * scale)))
        r_min = max(round(r_max * r_min_pct[preset["svf_noise"]] * 0.01), 1)
        out[name] = {
            "r_max_px": r_max,
            "r_min_px": int(r_min),
            "r_max_m": round(r_max * resolution, 3),
            "r_min_m": round(r_min * resolution, 3),
        }
    return out


if __name__ == "__main__":
    import time

    rng = np.random.default_rng(0)
    n = 512
    y, x = np.mgrid[0:n, 0:n].astype(np.float32)
    # A hillside, a bank and a ditch, plus 3 cm of noise.
    dem = 0.04 * x + 0.01 * y
    dem += 0.6 * np.exp(-(((y - 200) / 6.0) ** 2))
    dem -= 0.5 * np.exp(-(((y - 320) / 4.0) ** 2))
    dem += rng.normal(0, 0.03, dem.shape).astype(np.float32)

    for res in (0.25, 0.5, 0.6611):
        t = time.perf_counter()
        out = cvat(dem, res)
        dt = time.perf_counter() - t
        km2 = (n * res) ** 2 / 1e6
        print(f"{res:6.4f} m/px  {dt:6.2f} s  {dt / km2:8.1f} s/km2  "
              f"range {np.nanmin(out):.3f}..{np.nanmax(out):.3f}  "
              f"radii {radii_for(res)}")
