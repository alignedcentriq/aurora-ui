import datetime
from sqlalchemy.orm import Session
from app.database import SessionLocal
from app.models import PromptConfig, PromptDraft

# Roles allowed to manage each domain's prompts
ROLE_DOMAIN_MAP: dict[str, list[str]] = {
    "hr": ["hr"],
    "it": ["it_support"],
    "pmo": ["pmo"],
    "admin": ["hr", "admin", "it_support", "pmo", "functional_manager"],
}

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
    def delete_prompt(domain: str, prompt_key: str, deleted_by: str) -> str:
        db = SessionLocal()
        try:
            config = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == domain,
                PromptConfig.prompt_key == prompt_key,
                PromptConfig.is_active == True,
            ).order_by(PromptConfig.version.desc()).first()
            if not config:
                return "No active prompt found."
            config.is_active = False
            db.commit()
            return f"Prompt deleted for {domain} ({prompt_key})."
        finally:
            db.close()

    @staticmethod
    def save_draft(domain: str, prompt_key: str, value: str, submitted_by: str) -> dict:
        db = SessionLocal()
        try:
            existing = db.query(PromptDraft).filter(
                PromptDraft.agent_domain == domain,
                PromptDraft.prompt_key == prompt_key,
                PromptDraft.submitted_by == submitted_by,
                PromptDraft.status == "pending",
            ).first()
            if existing:
                existing.draft_value = value
                db.commit()
                return {"id": existing.id, "message": "Draft updated — awaiting approval."}
            draft = PromptDraft(
                agent_domain=domain,
                prompt_key=prompt_key,
                draft_value=value,
                submitted_by=submitted_by,
            )
            db.add(draft)
            db.commit()
            db.refresh(draft)
            return {"id": draft.id, "message": "Draft submitted — awaiting a second approval."}
        finally:
            db.close()

    @staticmethod
    def list_pending_drafts(domain: str = None, exclude_email: str = None) -> list:
        db = SessionLocal()
        try:
            q = db.query(PromptDraft).filter(PromptDraft.status == "pending")
            if domain:
                q = q.filter(PromptDraft.agent_domain == domain)
            if exclude_email:
                q = q.filter(PromptDraft.submitted_by != exclude_email)
            return [
                {
                    "id": d.id,
                    "domain": d.agent_domain,
                    "key": d.prompt_key,
                    "value": d.draft_value,
                    "submitted_by": d.submitted_by,
                    "created_at": d.created_at.isoformat(),
                }
                for d in q.order_by(PromptDraft.created_at.desc()).all()
            ]
        finally:
            db.close()

    @staticmethod
    def approve_draft(draft_id: int, reviewed_by: str) -> str:
        db = SessionLocal()
        try:
            draft = db.query(PromptDraft).filter(PromptDraft.id == draft_id).first()
            if not draft:
                return "Draft not found."
            if draft.status != "pending":
                return f"Draft is already {draft.status}."
            if draft.submitted_by == reviewed_by:
                return "You cannot approve your own draft."

            current = db.query(PromptConfig).filter(
                PromptConfig.agent_domain == draft.agent_domain,
                PromptConfig.prompt_key == draft.prompt_key,
                PromptConfig.is_active == True,
            ).order_by(PromptConfig.version.desc()).first()

            new_version = (current.version + 1) if current else 1
            if current:
                current.is_active = False

            db.add(PromptConfig(
                agent_domain=draft.agent_domain,
                prompt_key=draft.prompt_key,
                prompt_value=draft.draft_value,
                version=new_version,
                is_active=True,
                allowed_roles="admin,hr,it,pmo",
                created_by=reviewed_by,
            ))
            draft.status = "approved"
            draft.reviewed_by = reviewed_by
            draft.reviewed_at = datetime.datetime.utcnow()
            db.commit()
            return f"Approved and applied as version {new_version}."
        finally:
            db.close()

    @staticmethod
    def reject_draft(draft_id: int, reviewed_by: str) -> str:
        db = SessionLocal()
        try:
            draft = db.query(PromptDraft).filter(PromptDraft.id == draft_id).first()
            if not draft:
                return "Draft not found."
            if draft.submitted_by == reviewed_by:
                return "You cannot reject your own draft."
            draft.status = "rejected"
            draft.reviewed_by = reviewed_by
            draft.reviewed_at = datetime.datetime.utcnow()
            db.commit()
            return "Draft rejected."
        finally:
            db.close()

    @staticmethod
    def test_prompt(domain: str, draft_value: str, test_query: str) -> str:
        """Run a draft prompt against a test query without saving — returns raw LLM response."""
        from langchain_openai import ChatOpenAI
        from langchain_core.messages import HumanMessage, SystemMessage
        from app.config import settings

        llm = ChatOpenAI(
            base_url=settings.AGENT_BASE_URL,
            api_key=settings.AGENT_API_KEY,
            model=settings.AGENT_MODEL_NAME,
            temperature=0,
        )
        result = llm.invoke([SystemMessage(content=draft_value), HumanMessage(content=test_query)])
        return result.content

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
