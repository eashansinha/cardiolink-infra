# Seeds the local firmware bucket with a validly signed firmware image + manifest.
import base64
import json
import os

import boto3
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa

BUCKET = "cardiolink-firmware-images"
MODEL = "cl-monitor-v2"
ENDPOINT = os.environ.get("S3_ENDPOINT_URL", "http://s3:9000")


def main():
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pub_pem = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    os.makedirs("/out", exist_ok=True)
    with open("/out/firmware_signing.pub", "wb") as fh:
        fh.write(pub_pem)

    image = b"CARDIOLINK-FW-v2.4.1-" + os.urandom(2048)
    sig = key.sign(image, padding.PKCS1v15(), hashes.SHA256())

    s3 = boto3.client(
        "s3",
        endpoint_url=ENDPOINT,
        aws_access_key_id="minioadmin",
        aws_secret_access_key="minioadmin",
    )
    try:
        s3.create_bucket(Bucket=BUCKET)
    except Exception:
        pass
    image_key = f"{MODEL}/cardiolink-fw-2.4.1.bin"
    s3.put_object(Bucket=BUCKET, Key=image_key, Body=image)
    manifest = {
        "version": "2.4.1",
        "image_key": image_key,
        "signature": base64.b64encode(sig).decode(),
    }
    s3.put_object(
        Bucket=BUCKET, Key=f"{MODEL}/manifest.json", Body=json.dumps(manifest).encode()
    )
    print("seeded firmware for", MODEL)


if __name__ == "__main__":
    main()
