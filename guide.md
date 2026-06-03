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

<!-- Claude Memory Sync (share AI memory across machines via git) -->

After cloning the repo, run this once to link Claude's memory to the project:


Windows (Command Prompt — no admin or Developer Mode needed):

  mkdir "%USERPROFILE%\.claude\projects\C:-Users-yourname-aurora-ui"
  mklink /J "%USERPROFILE%\.claude\projects\C:-Users-yourname-aurora-ui\memory" ".claude\memory"

  Replace "yourname" with your Windows username.
