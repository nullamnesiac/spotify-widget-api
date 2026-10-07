import ssl
import urllib.request
import urllib.parse
import json
import base64


# --- PASTE YOUR CREDENTIALS HERE ---
CLIENT_ID = "3b95c10d17bd45e3b8f82aada7f7af72"
CLIENT_SECRET = "71133a102df347a6b9995a02abb2a76e"
# -----------------------------------

REDIRECT_URI = "http://127.0.0.1:3000"

print("1. Click this URL to authorize your Spotify account:")
url = f"https://accounts.spotify.com/authorize?client_id={CLIENT_ID}&response_type=code&redirect_uri={urllib.parse.quote(REDIRECT_URI)}&scope=user-read-currently-playing"
print(f"\n{url}\n")
print("2. You will be redirected to a 'localhost' page that looks broken. This is normal!")
print("3. Look at the URL bar. Copy the long text immediately following '?code=' and paste it below.")

code = input("\nEnter the code: ").strip()

auth_str = f"{CLIENT_ID}:{CLIENT_SECRET}"
b64_auth_str = base64.b64encode(auth_str.encode()).decode()

data = urllib.parse.urlencode({
    "grant_type": "authorization_code",
    "code": code,
    "redirect_uri": REDIRECT_URI
}).encode("utf-8")

req = urllib.request.Request(
    "https://accounts.spotify.com/api/token",
    data=data,
    headers={
        "Authorization": f"Basic {b64_auth_str}",
        "Content-Type": "application/x-www-form-urlencoded"
    }
)

try:
    # Create the SSL context to bypass the macOS certificate error
    context = ssl._create_unverified_context()

    # Pass the context into urlopen
    with urllib.request.urlopen(req, context=context) as response:
        res_data = json.loads(response.read().decode())
        print("\nSUCCESS! Here is your Refresh Token. KEEP IT SECRET:")
        print("-" * 50)
        print(res_data.get("refresh_token"))
        print("-" * 50)
except Exception as e:
    print("Error:", e)