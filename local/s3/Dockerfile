# S3 stand-in for the firmware bucket (moto server).
FROM python:3.12-slim
ARG PIP_INDEX_URL
RUN pip install --no-cache-dir "moto[server]==5.0.14"
EXPOSE 9000
CMD ["moto_server", "-H", "0.0.0.0", "-p", "9000"]
