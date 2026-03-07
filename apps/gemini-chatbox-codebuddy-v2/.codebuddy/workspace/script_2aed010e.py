import requests
import time
import subprocess

try:
    # Start the server in the background
    server_process = subprocess.Popen(['node', 'server.mjs'], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    print("Server started in background.")

    # Give the server a moment to start
    time.sleep(5)

    # Attempt to connect to the health endpoint
    response = requests.get('http://localhost:3000/health')

    if response.status_code == 200:
        print(f"Health check successful: {response.text}")
    else:
        print(f"Health check failed: Status code {response.status_code}, Response: {response.text}")

    # Terminate the server process
    server_process.terminate()
    print("Server terminated.")

except Exception as e:
    print(f"An error occurred: {e}")