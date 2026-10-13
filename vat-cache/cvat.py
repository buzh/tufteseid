
import numpy as np
from rvt.blend_func import blend_images, normalize_image, render_images
from rvt.vis import byte_scale, hillshade, sky_view_factor, slope_aspect

__all__ = ["VAT_PRESETS", "byte_scale", "cvat", "radii_for"]

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

COMBINED_OPACITY = 50

CALIBRATION_M_PER_PX = 0.5

def _stack(dem, resolution, preset, radius_scale):
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

        top = blend_images(mode, norm, rendered)
        rendered = render_images(top, rendered, opacity)
    return rendered

def cvat(dem, resolution, radius_in_metres=True):
    scale = CALIBRATION_M_PER_PX / resolution if radius_in_metres else 1.0

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
