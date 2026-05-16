import os
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
from dotenv import load_dotenv

def test_smtp_connection():
    # Load environment variables from .env file
    load_dotenv()
    
    smtp_host = os.getenv("SMTP_HOST")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")
    smtp_pass = os.getenv("SMTP_PASS")
    smtp_from = os.getenv("SMTP_FROM_NAME", "Centriq AI Test")
    
    if not smtp_user or "your_email" in smtp_user:
        print("❌ Error: Please update SMTP_USER and SMTP_PASS in your .env file with real credentials.")
        return

    print(f"🔄 Attempting to connect to {smtp_host}:{smtp_port} as {smtp_user}...")
    
    try:
        # Create a simple test email
        msg = MIMEMultipart("alternative")
        msg["From"] = f"{smtp_from} <{smtp_user}>"
        msg["To"] = smtp_user  # Sending to yourself to test
        msg["Subject"] = "Centriq AI - SMTP Connection Test"
        
        body = "If you are reading this, your Office 365 SMTP configuration is working perfectly!"
        msg.attach(MIMEText(body, "plain"))

        # Connect and send
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.set_debuglevel(1)  # Enable debug output to see the SMTP transaction
            print("🔒 Starting TLS...")
            server.starttls()
            print("🔑 Logging in...")
            server.login(smtp_user, smtp_pass)
            print("📧 Sending test email...")
            server.sendmail(smtp_user, [smtp_user], msg.as_string())
            
        print("\n✅ Success! Test email was sent to your own address.")
        
    except smtplib.SMTPAuthenticationError as e:
        print(f"\n❌ Authentication Failed: {e}")
        print("-> Make sure you are using an App Password if MFA is enabled.")
        print("-> Check if SMTP AUTH is enabled for your mailbox in Office 365 Admin Center.")
    except Exception as e:
        print(f"\n❌ Error connecting or sending email: {e}")

if __name__ == "__main__":
    test_smtp_connection()
