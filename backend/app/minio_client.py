import boto3
from botocore.client import Config
from app.config import settings
import io

class MinioClient:
    def __init__(self):
        self.endpoint = settings.MINIO_ENDPOINT
        self.access_key = settings.MINIO_ACCESS_KEY
        self.secret_key = settings.MINIO_SECRET_KEY
        self.bucket_name = settings.MINIO_BUCKET_NAME
        self.secure = settings.MINIO_SECURE

        # Use boto3 with MinIO
        self.s3 = boto3.client(
            's3',
            endpoint_url=f"{'https' if self.secure else 'http'}://{self.endpoint}",
            aws_access_key_id=self.access_key,
            aws_secret_access_key=self.secret_key,
            config=Config(signature_version='s3v4'),
            region_name='us-east-1' # Minio doesn't care much about region but boto3 needs it
        )

    def upload_file(self, file_content, object_name):
        """
        Uploads a file to MinIO.
        file_content: bytes or file-like object
        object_name: name of the object in MinIO
        """
        if isinstance(file_content, bytes):
            file_obj = io.BytesIO(file_content)
        else:
            file_obj = file_content

        self.s3.upload_fileobj(file_obj, self.bucket_name, object_name)
        return f"{self.endpoint}/{self.bucket_name}/{object_name}"

    def download_file(self, object_name: str) -> bytes:
        """Download an object from MinIO and return its raw bytes."""
        buf = io.BytesIO()
        self.s3.download_fileobj(self.bucket_name, object_name, buf)
        return buf.getvalue()

    def upload_bytes(self, data: bytes, object_name: str, content_type: str = "image/png") -> str:
        """Upload raw bytes to MinIO and return the object name."""
        self.s3.upload_fileobj(
            io.BytesIO(data),
            self.bucket_name,
            object_name,
            ExtraArgs={"ContentType": content_type},
        )
        return object_name

    def get_presigned_url(self, object_name: str, expiry: int = 86400) -> str:
        """Return a presigned GET URL valid for `expiry` seconds (default 24 h)."""
        return self.s3.generate_presigned_url(
            "get_object",
            Params={"Bucket": self.bucket_name, "Key": object_name},
            ExpiresIn=expiry,
        )

    def list_objects(self, prefix=''):
        response = self.s3.list_objects_v2(Bucket=self.bucket_name, Prefix=prefix)
        return response.get('Contents', [])

minio_client = MinioClient()
