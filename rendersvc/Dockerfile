# Build context is the repo root, for `vat-cache/fetch_dem.py`:
#   docker compose build rendersvc
FROM python:3.12-slim

# ffmpeg for libvpx-vp9, DejaVu for the burnt-in legend. The paths the fonts
# land on are named in legend.py.
RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY rendersvc/requirements.txt ./
# rvt-py goes in --no-deps: it declares gdal, rasterio, geopandas and jupyter
# for an IO layer none of this touches, and requirements.txt already carries
# what rvt.vis needs.
RUN pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir --no-deps rvt-py==2.2.3

# One float-TIFF reader for the whole repo. Its treatment of absent tiles is
# load-bearing here: a generic reader hands back zeros, and sea level already
# reads exactly 0.0.
COPY vat-cache/fetch_dem.py ./
COPY rendersvc/*.py ./

RUN useradd --system --no-create-home rendersvc
USER rendersvc

ENV PYTHONUNBUFFERED=1
EXPOSE 8080
CMD ["python", "server.py"]
