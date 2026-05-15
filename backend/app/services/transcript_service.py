import datetime
from app.database import SessionLocal
from app.models import SessionTranscript, Project


class TranscriptService:

    @staticmethod
    def save_transcript(
        project_name: str,
        session_title: str,
        summary: str,
        session_type: str = "Flash Review",
        uploaded_by: str = "system",
        transcript_text: str = "",
    ) -> str:
        db = SessionLocal()
        try:
            project = db.query(Project).filter(Project.name.ilike(f"%{project_name}%")).first()
            if not project:
                names = [p.name for p in db.query(Project).all()]
                return f"No project found matching '{project_name}'. Available: {', '.join(names)}"

            transcript = SessionTranscript(
                project_name=project.name,
                session_title=session_title,
                summary=summary,
                session_type=session_type,
                uploaded_by=uploaded_by,
                transcript_text=transcript_text,
                session_date=datetime.date.today(),
            )
            db.add(transcript)
            db.commit()
            return f"Session transcript '{session_title}' saved for project '{project.name}' ({session_type})."
        finally:
            db.close()

    @staticmethod
    def search_transcripts(query: str, project_name: str = None, limit: int = 5) -> list:
        db = SessionLocal()
        try:
            q = db.query(SessionTranscript).order_by(SessionTranscript.created_at.desc())
            if project_name:
                q = q.filter(SessionTranscript.project_name.ilike(f"%{project_name}%"))
            all_transcripts = q.all()

            query_lower = query.lower()
            matched = [
                t for t in all_transcripts
                if (query_lower in (t.summary or "").lower()
                    or query_lower in (t.transcript_text or "").lower()
                    or query_lower in (t.session_title or "").lower()
                    or query_lower in (t.project_name or "").lower())
            ][:limit]

            return [
                {
                    "id": t.id,
                    "project": t.project_name,
                    "title": t.session_title,
                    "type": t.session_type,
                    "date": str(t.session_date),
                    "summary": (t.summary or "")[:400],
                }
                for t in matched
            ]
        finally:
            db.close()

    @staticmethod
    def get_recent_sessions(project_name: str = None, limit: int = 5) -> list:
        db = SessionLocal()
        try:
            q = db.query(SessionTranscript).order_by(SessionTranscript.created_at.desc())
            if project_name:
                q = q.filter(SessionTranscript.project_name.ilike(f"%{project_name}%"))
            sessions = q.limit(limit).all()
            return [
                {
                    "id": t.id,
                    "project": t.project_name,
                    "title": t.session_title,
                    "type": t.session_type,
                    "date": str(t.session_date),
                    "summary": (t.summary or "")[:400],
                }
                for t in sessions
            ]
        finally:
            db.close()
