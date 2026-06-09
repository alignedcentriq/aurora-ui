#!/bin/sh
# Start the Nexus Library mock server in the background, then start the main app.
uvicorn mock_nexus_library_server:app --host 0.0.0.0 --port 8092 &
exec uvicorn app.main:app --host 0.0.0.0 --port 8080
