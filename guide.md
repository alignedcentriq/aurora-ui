<!-- For Docker Usage using WSL -->

1: wsl --list --online

Download Ubuntu

2: wsl --install -d Ubuntu

Restart CMD and Run

3: wsl

Run Sudo

4: sudo apt update

Install Docker

5: sudo apt install docker.io -y

Start Docker

sudo service docker start

<!-- To Install Redis in WSL -->

1: sudo apt install redis-server -y

2: sudo service redis-server start

3: redis-cli ping

<!-- To run in docker (Redis) -->

sudo docker-compose up -d redis

<!-- Install MinIO -->

wget https://dl.min.io/server/minio/release/linux-amd64/minio
chmod +x minio
./minio server ~/minio-data --console-address ":9001"

<!-- To install docker-compose in wsl -->

sudo apt-get install docker-compose
