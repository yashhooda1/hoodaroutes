# init_auth.py — run ONCE locally to create the Garmin token store.
# Handles MFA interactively. Prints a GARMIN_TOKENS_B64 value you can paste
# into Railway as a single secret (env-only deploy — no volume needed).
#
#   python init_auth.py
#
import os
import io
import base64
import tarfile
import getpass
from garminconnect import Garmin


def main():
    email = input("Garmin Connect email: ").strip()
    password = getpass.getpass("Password: ")
    tokenstore = os.environ.get("GARMINTOKENS", os.path.expanduser("~/.garminconnect"))

    g = Garmin(email=email, password=password)
    # If your account has MFA, the library prompts for the code here.
    g.login()
    g.garth.dump(tokenstore)
    print(f"\n✓ Tokens saved to: {tokenstore}")

    # Pack the token store into one base64 blob for env-only deploy (Railway).
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(tokenstore, arcname=".")
    b64 = base64.b64encode(buf.getvalue()).decode()
    print("\nFor Railway (set as a SECRET env var):\n")
    print("GARMIN_TOKENS_B64=" + b64)
    print("\nKeep this private — it is your Garmin auth.")


if __name__ == "__main__":
    main()
