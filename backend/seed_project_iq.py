import sys
import os
import datetime

sys.path.insert(0, os.path.dirname(__file__))

from app.database import SessionLocal
from app.models import (
    ProjectProfile, ProjectCapability, ProjectIntegration,
    ProjectLesson, ProjectReusableAsset, ProjectExpertise
)

def seed_project_iq():
    db = SessionLocal()
    try:
        # Define mock profiles
        profiles_data = [
            {
                "project_slug": "project-phoenix",
                "name": "Project Phoenix E-Commerce Migration",
                "client_industry": "Retail & E-commerce",
                "status": "Completed",
                "business_problem": "The client's legacy monolithic e-commerce engine suffered from severe latency spikes during peak holiday traffic, leading to cart abandonments and cart losses estimated at $1.2M annually. The existing checkout system also lacked secure integration with localized payment gateways.",
                "solution_summary": "Architected and delivered a headless microservices e-commerce platform using Next.js on the frontend, Go-based API microservices, and Redis for high-throughput cart storage. Migrated database operations to PostgreSQL with automated read-replicas. Integrated global and regional Stripe and PayPal payment processors.",
                "business_outcomes": "Reduced core checkout latency by 64% (from 1.8s to 640ms). Achieved 99.99% uptime during Black Friday rush with zero reported outages. Deflected checkout abandonment rate by 18%, increasing revenue by an estimated $850k in the first quarter.",
                "technology_stack": ["Next.js", "Golang", "PostgreSQL", "Redis", "Stripe API", "Docker", "AWS ECS"],
                "architecture_summary": "Decoupled headless React architecture with a centralized API Gateway routing traffic to containerized Go microservices. Leveraged Redis as a stateful caching layer for user sessions and real-time inventory checks.",
                "complexity_drivers": ["Distributed Redis locking for real-time inventory", "Zero-downtime database migration", "Multi-region cart state synchronization"],
                "project_size": "Large (18 months)",
                "team_size": "14 delivery experts",
                "delivery_start_date": "2024-03-01",
                "delivery_end_date": "2025-09-01",
                "confidence": "verified",
                "review_status": "reviewed",
                "reviewed_by": "pmo.director@centriq.ai",
                "source_doc_count": 12,
                "dna_summary": "Project Phoenix E-Commerce Migration Retail & E-commerce Legacy monolithic e-commerce engine Cart abandonments checkout latency Headless microservices Next.js Go Redis PostgreSQL AWS ECS Stripe API",
                "capabilities": [
                    {"capability_name": "Headless Architecture", "category": "Frontend Development", "maturity_level": "Expert", "confidence": "verified", "evidence": "Production deployment of Next.js static site generation with ISR."},
                    {"capability_name": "Distributed Caching", "category": "Backend Systems", "maturity_level": "Intermediate", "confidence": "verified", "evidence": "Implemented Redis key-value caching with TTL policies for cart sessions."}
                ],
                "integrations": [
                    {"system_name": "Stripe Gateway", "integration_type": "Payment API", "complexity_level": "Medium", "lessons_learned": "Stripe webhooks need a robust retry queue to handle transient receiver downtime.", "confidence": "verified"}
                ],
                "lessons": [
                    {"category": "DevOps", "lesson": "Db migration locks can block live writes.", "impact_level": "High", "recommendation": "Perform schema changes in backward-compatible phases to avoid catalog locking.", "confidence": "verified", "evidence": "Locked inventory table for 12 minutes during sprint 4 release."}
                ],
                "reusable_assets": [
                    {"asset_name": "Golang Redis Session Wrapper", "asset_type": "Boilerplate / Library", "repository_url": "https://github.com/centriq-internal/go-redis-session", "owner": "Alex Rivera", "reuse_readiness": "Production-Ready", "documentation_url": "https://wiki.centriq.ai/go-redis-session", "confidence": "verified"}
                ],
                "expertise": [
                    {"person_name": "Alex Rivera", "role_on_project": "Lead Developer", "capability": "Go Backend Microservices", "evidence_level": "verified"},
                    {"person_name": "Sophia Chen", "role_on_project": "Frontend Architect", "capability": "Next.js Headless Optimization", "evidence_level": "verified"}
                ]
            },
            {
                "project_slug": "titan-cloud",
                "name": "Titan Financial Services Cloud Migration",
                "client_industry": "Banking & Finance",
                "status": "In Progress",
                "business_problem": "The client faced escalating on-premise infrastructure costs and compliance issues under updated financial regulations. They needed to move their main ledger and loan processing applications to Microsoft Azure while satisfying strict data residency policies.",
                "solution_summary": "Designing a hybrid cloud landing zone using Azure Kubernetes Service (AKS) and Azure SQL Database Managed Instance. Implementing strict encryption at rest and in transit using Azure Key Vault and customer-managed keys. Automating network isolation with Azure ExpressRoute.",
                "business_outcomes": "Projected infrastructure cost reduction of 32%. Guaranteed compliance with country-specific financial data residency directives. Accelerated loan application processing time by 40% through cloud scaling.",
                "technology_stack": ["Microsoft Azure", "Kubernetes (AKS)", "Azure SQL", "Terraform", "Azure Key Vault"],
                "architecture_summary": "Hybrid infrastructure with a private network tunnel bridging the client's remaining on-prem datacenters to Azure subscription virtual networks. Strict microservice separation using network policies.",
                "complexity_drivers": ["Strict HIPAA and financial security compliance", "Customer-managed key rotations", "AKS private link configurations"],
                "project_size": "Enterprise (Ongoing)",
                "team_size": "22 engineers",
                "delivery_start_date": "2025-01-15",
                "delivery_end_date": None,
                "confidence": "inferred",
                "review_status": "draft",
                "reviewed_by": None,
                "source_doc_count": 8,
                "dna_summary": "Titan Financial Services Cloud Migration Banking & Finance Cloud migration Azure AKS Kubernetes Azure SQL Terraform Key Vault Encryption hybrid infrastructure security compliance",
                "capabilities": [
                    {"capability_name": "Cloud Security Landing Zone", "category": "Cloud & Infra", "maturity_level": "Expert", "confidence": "verified", "evidence": "Built landing zone with Terraform matching banking guidelines."}
                ],
                "integrations": [
                    {"system_name": "On-prem core ledger", "integration_type": "Direct Database Link", "complexity_level": "High", "lessons_learned": "Data latency across hybrid tunnels requires asynchronous query queuing.", "confidence": "inferred"}
                ],
                "lessons": [
                    {"category": "Cloud Planning", "lesson": "Azure ExpressRoute configuration can take weeks.", "impact_level": "Medium", "recommendation": "Initiate connection requests with local network providers early in the project lifecycle.", "confidence": "inferred", "evidence": "Provider provisioning delay pushed sprint 2 cloud testing back by 10 days."}
                ],
                "reusable_assets": [
                    {"asset_name": "AKS Terraform Secure Blueprint", "asset_type": "Infrastructure Template", "repository_url": "https://github.com/centriq-internal/aks-secure-blueprint", "owner": "Marcus Brody", "reuse_readiness": "Review Required", "documentation_url": "https://wiki.centriq.ai/aks-blueprint", "confidence": "verified"}
                ],
                "expertise": [
                    {"person_name": "Marcus Brody", "role_on_project": "DevOps Lead", "capability": "Terraform Infrastructure Coding", "evidence_level": "verified"},
                    {"person_name": "Sarah Jenkins", "role_on_project": "Security Officer", "capability": "Cloud Data Residency", "evidence_level": "inferred"}
                ]
            },
            {
                "project_slug": "helix-ai",
                "name": "Helix Clinical Trial Analysis System",
                "client_industry": "Healthcare & Life Sciences",
                "status": "Completed",
                "business_problem": "Clinical trial reporting was severely delayed because analyzing massive volumes of patient charts, physician notes, and laboratory logs required manual parsing by specialists, creating a backlog of 6+ weeks.",
                "solution_summary": "Developed a secure AI-assisted trial analysis portal. Leveraged OpenAI GPT-4 models hosted on Azure OpenAI Service to extract dosage responses and adverse events from unstructured doctor notes. Utilized Langfuse for request logging and observability.",
                "business_outcomes": "Cut documentation parsing backlog from 6 weeks to under 4 hours. Automated extraction achieved a 94.2% semantic accuracy match compared to human specialists. Allowed clinical teams to detect drug safety signals 5 weeks earlier.",
                "technology_stack": ["React", "Python", "FastAPI", "Azure OpenAI", "Langfuse", "Tailwind CSS"],
                "architecture_summary": "Modern single page application communicating with a secure Python API. Background workers run batch processing of documents with queue monitoring and semantic deduplication.",
                "complexity_drivers": ["Extracting nested parameters from unstructured notes", "GDPR & HIPAA compliance constraints", "Real-time stream parsing for long documents"],
                "project_size": "Medium (9 months)",
                "team_size": "6 developers",
                "delivery_start_date": "2024-06-01",
                "delivery_end_date": "2025-03-01",
                "confidence": "verified",
                "review_status": "reviewed",
                "reviewed_by": "pmo.director@centriq.ai",
                "source_doc_count": 14,
                "dna_summary": "Helix Clinical Trial Analysis System Healthcare & Life Sciences AI trial analysis portal OpenAI GPT-4 Azure OpenAI Langfuse FastAPI extraction dosage safety compliance",
                "capabilities": [
                    {"capability_name": "Generative AI Parsing", "category": "AI/ML Solutions", "maturity_level": "Expert", "confidence": "verified", "evidence": "Deployed custom LLM system extracting Adverse Events from 40k trial notes."}
                ],
                "integrations": [
                    {"system_name": "Epic Systems EMR", "integration_type": "FHIR API", "complexity_level": "High", "lessons_learned": "EMR sandbox credentials should be requested at project kickoff due to hospital approval processes.", "confidence": "verified"}
                ],
                "lessons": [
                    {"category": "LLM Stability", "lesson": "LLM JSON schema enforcement requires strict prompt boundaries.", "impact_level": "High", "recommendation": "Use structured extraction tool calls rather than raw system instructions to prevent json parse errors.", "confidence": "verified", "evidence": "Encountered 4.8% format failure rate with raw system instructions."}
                ],
                "reusable_assets": [
                    {"asset_name": "Langfuse Observability Decorators", "asset_type": "Python Utility", "repository_url": "https://github.com/centriq-internal/langfuse-python-decorators", "owner": "Nisha Kulkarni", "reuse_readiness": "Production-Ready", "documentation_url": "https://wiki.centriq.ai/langfuse-decorators", "confidence": "verified"}
                ],
                "expertise": [
                    {"person_name": "Nisha Kulkarni", "role_on_project": "AI Engineer", "capability": "LLM Orchestration and Guardrails", "evidence_level": "verified"},
                    {"person_name": "Vikram Malhotra", "role_on_project": "Clinical Compliance Lead", "capability": "HIPAA Patient Anonymization", "evidence_level": "verified"}
                ]
            }
        ]

        # Clean existing mock profiles
        slugs = [p["project_slug"] for p in profiles_data]
        existing = db.query(ProjectProfile).filter(ProjectProfile.project_slug.in_(slugs)).all()
        if existing:
            for p in existing:
                db.delete(p)
            db.commit()
            print(f"Cleaned {len(existing)} existing mock project profiles.")

        # Seed new ones
        for data in profiles_data:
            profile = ProjectProfile(
                project_slug=data["project_slug"],
                name=data["name"],
                client_industry=data["client_industry"],
                status=data["status"],
                business_problem=data["business_problem"],
                solution_summary=data["solution_summary"],
                business_outcomes=data["business_outcomes"],
                technology_stack=data["technology_stack"],
                architecture_summary=data["architecture_summary"],
                complexity_drivers=data["complexity_drivers"],
                project_size=data["project_size"],
                team_size=data["team_size"],
                delivery_start_date=data["delivery_start_date"],
                delivery_end_date=data["delivery_end_date"],
                confidence=data["confidence"],
                review_status=data["review_status"],
                reviewed_by=data["reviewed_by"],
                reviewed_at=datetime.datetime.utcnow() if data["reviewed_by"] else None,
                source_doc_count=data["source_doc_count"],
                dna_summary=data["dna_summary"]
            )
            db.add(profile)
            db.flush()

            # Add capabilities
            for c in data["capabilities"]:
                db.add(ProjectCapability(
                    profile_id=profile.id,
                    capability_name=c["capability_name"],
                    category=c.get("category"),
                    maturity_level=c.get("maturity_level"),
                    confidence=c.get("confidence"),
                    evidence=c.get("evidence")
                ))

            # Add integrations
            for i in data["integrations"]:
                db.add(ProjectIntegration(
                    profile_id=profile.id,
                    system_name=i["system_name"],
                    integration_type=i.get("integration_type"),
                    complexity_level=i.get("complexity_level"),
                    lessons_learned=i.get("lessons_learned"),
                    confidence=i.get("confidence")
                ))

            # Add lessons
            for l in data["lessons"]:
                db.add(ProjectLesson(
                    profile_id=profile.id,
                    category=l.get("category"),
                    lesson=l["lesson"],
                    impact_level=l.get("impact_level"),
                    recommendation=l.get("recommendation"),
                    confidence=l.get("confidence"),
                    evidence=l.get("evidence")
                ))

            # Add assets
            for a in data["reusable_assets"]:
                db.add(ProjectReusableAsset(
                    profile_id=profile.id,
                    asset_name=a["asset_name"],
                    asset_type=a.get("asset_type"),
                    repository_url=a.get("repository_url"),
                    owner=a.get("owner"),
                    reuse_readiness=a.get("reuse_readiness"),
                    documentation_url=a.get("documentation_url"),
                    confidence=a.get("confidence")
                ))

            # Add expertise
            for exp in data["expertise"]:
                db.add(ProjectExpertise(
                    profile_id=profile.id,
                    person_name=exp["person_name"],
                    role_on_project=exp.get("role_on_project"),
                    capability=exp.get("capability"),
                    evidence_level=exp.get("evidence_level")
                ))

        db.commit()
        print(f"Successfully seeded {len(profiles_data)} project profiles with child entities.")
    except Exception as e:
        db.rollback()
        print(f"Error seeding database: {e}")
    finally:
        db.close()

if __name__ == "__main__":
    seed_project_iq()
