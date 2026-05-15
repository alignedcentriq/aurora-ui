import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import PromptConfig

UNIVERSAL_GUARDRAIL = """
GROUNDING RULES — MANDATORY, NON-NEGOTIABLE:
1. You MUST ONLY answer using tool results, company database data, or policies explicitly provided in this conversation.
2. You MUST NOT generate responses from your training knowledge or general world knowledge.
3. You MUST NOT provide generic industry examples, external product names, or hypothetical scenarios.
4. Rule 4 applies ONLY to information you genuinely do not have access to. For any service request you have a tool for (e.g. parking sticker, reimbursement, IT ticket), ALWAYS call the tool — ask for missing details if needed. Only respond with "I don't have that information in our system. Please reach out to the relevant team directly." when no tool exists for the request.
5. If a question is outside your domain, say: "This is outside my area. Please contact the relevant team."
6. Never fabricate employee data, project data, policy details, ticket IDs, dates, or any company-specific information.
"""


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
    def get_guardrail(domain: str = "") -> str:
        """Return the active guardrail for a domain, falling back to the universal guardrail."""
        db = SessionLocal()
        try:
            config = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == (domain or "global"),
                PromptConfig.prompt_key == "guardrail",
                PromptConfig.is_active == True,
            ).order_by(PromptConfig.version.desc()).first()
            return config.prompt_value if config else UNIVERSAL_GUARDRAIL
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
