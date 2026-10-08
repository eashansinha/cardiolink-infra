FROM python:3.12-slim
ARG PIP_INDEX_URL
RUN pip install --no-cache-dir boto3==1.35.20 cryptography==43.0.1
COPY seed.py /seed.py
CMD ["python", "/seed.py"]
