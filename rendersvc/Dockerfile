FROM python:3.11-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY rendersvc/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
  && pip install --no-cache-dir --no-deps rvt-py==2.2.3

COPY vat-cache/fetch_dem.py ./
COPY rendersvc/*.py ./

RUN useradd --system --no-create-home rendersvc
USER rendersvc

ENV PYTHONUNBUFFERED=1
ENV MPLCONFIGDIR=/tmp/matplotlib
EXPOSE 8080
CMD ["python", "server.py"]
