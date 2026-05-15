import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import PromptConfig

class PromptService:
    @staticmethod
    def get_system_prompt(domain: str, default_prompt: str = "") -> str:
        db = SessionLocal()
        try:
            config = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.prompt_key == "system_prompt",
                PromptConfig.is_active == True
            ).order_by(PromptConfig.version.desc()).first()
            
            if config:
                return config.prompt_value
            return default_prompt
        finally:
            db.close()

    @staticmethod
    def update_prompt(domain: str, prompt_key: str, value: str, updated_by: str, user_role: str):
        db = SessionLocal()
        try:
            # Check if role is authorized
            config = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.prompt_key == prompt_key,
                PromptConfig.is_active == True
            ).order_by(PromptConfig.version.desc()).first()
            
            if config:
                allowed_roles = config.allowed_roles.split(",")
                if user_role not in allowed_roles:
                    return f"Unauthorized. Roles allowed: {config.allowed_roles}"
                
                # Deactivate current
                config.is_active = False
                new_version = config.version + 1
            else:
                new_version = 1
                allowed_roles = "admin" # Default
                
            new_config = PromptConfig(
                agent_domain=domain,
                prompt_key=prompt_key,
                prompt_value=value,
                version=new_version,
                is_active=True,
                allowed_roles=",".join(allowed_roles) if config else allowed_roles,
                created_by=updated_by
            )
            db.add(new_config)
            db.commit()
            return f"Prompt updated for {domain} ({prompt_key}) to version {new_version}."
        finally:
            db.close()

    @staticmethod
    def list_prompts(domain: str = None):
        db = SessionLocal()
        try:
            query = db.query(PromptConfig).filter(PromptConfig.is_active == True)
            if domain:
                query = query.filter(PromptConfig.agent_domain == domain)
            
            configs = query.all()
            return [
                {
                    "domain": c.agent_domain,
                    "key": c.prompt_key,
                    "value": c.prompt_value,
                    "version": c.version,
                    "updated_at": c.updated_at.isoformat()
                } for c in configs
            ]
        finally:
            db.close()
