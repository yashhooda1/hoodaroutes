# init_auth.py — local Garmin auth with MFA, version-proof token dump
import os, io, base64, tarfile, getpass
from garminconnect import Garmin

def main():
    email = input("Garmin Connect email: ").strip()
    password = getpass.getpass("Password: ")
    tokenstore = os.environ.get("GARMINTOKENS", os.path.expanduser("~/.garminconnect"))

    def prompt_mfa():
        return input("MFA code (from your authenticator/SMS): ").strip()

    g = Garmin(email=email, password=password, prompt_mfa=prompt_mfa)
    g.login()

    # Save tokens — handle whatever this version exposes.
    if hasattr(g, "garth"):
        g.garth.dump(tokenstore)
    elif hasattr(g, "client") and hasattr(g.client, "dump"):
        g.client.dump(tokenstore)
    elif hasattr(g, "dump"):
        g.dump(tokenstore)
    else:
        raise RuntimeError("Couldn't find a token-dump method on this version")

    print(f"\n✓ Tokens saved to: {tokenstore}")

    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz") as tar:
        tar.add(tokenstore, arcname=".")
    b64 = base64.b64encode(buf.getvalue()).decode()
    print("\nFor Railway (set as a SECRET env var):\n")
    print("GARMIN_TOKENS_B64=" + b64)
    print("\nKeep this private — it is your Garmin auth.")

if __name__ == "__main__":
    main()
