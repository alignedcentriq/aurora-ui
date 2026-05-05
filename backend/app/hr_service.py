import json
import os
import datetime

DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")

class JSONDatabase:
    @staticmethod
    def read(filename):
        with open(os.path.join(DATA_DIR, filename), "r") as f:
            return json.load(f)

    @staticmethod
    def write(filename, data):
        with open(os.path.join(DATA_DIR, filename), "w") as f:
            json.dump(data, f, indent=2)

class HRService:
    @staticmethod
    def get_employee_by_email(email):
        employees = JSONDatabase.read("employees.json")
        return next((e for e in employees if e["email"] == email), None)

    @staticmethod
    def get_leave_balance(email):
        emp = HRService.get_employee_by_email(email)
        if not emp: return "Employee not found."
        
        leaves = JSONDatabase.read("leaves.json")
        emp_leaves = [l for l in leaves if l["employee_id"] == emp["id"] and l["status"] == "Approved"]
        used = len(emp_leaves)
        balance = 24 - used
        return f"You have {balance} days of leave remaining (Used: {used} days)."

    @staticmethod
    def apply_leave(email, start_date, end_date, leave_type, reason="Applied via AI Assistant"):
        emp = HRService.get_employee_by_email(email)
        if not emp: return "Employee not found."
        
        leaves = JSONDatabase.read("leaves.json")
        new_leave = {
            "id": len(leaves) + 1,
            "employee_id": emp["id"],
            "leave_type": leave_type,
            "start_date": start_date,
            "end_date": end_date,
            "status": "Pending",
            "reason": reason
        }
        leaves.append(new_leave)
        JSONDatabase.write("leaves.json", leaves)
        return f"Success! Your {leave_type} leave request from {start_date} to {end_date} has been submitted for approval."

    @staticmethod
    def get_payroll_info(email):
        emp = HRService.get_employee_by_email(email)
        if not emp: return "Employee not found."
        
        payroll = JSONDatabase.read("payroll.json")
        emp_payroll = [p for p in payroll if p["employee_id"] == emp["id"]]
        if not emp_payroll: return "No payroll records found."
        
        last = emp_payroll[-1]
        return f"Your last net salary was ₹{last['net_salary']:,.2f} paid for {last['month']}/{last['year']}."

    @staticmethod
    def upsert_policy(title, content, category="General"):
        policies = JSONDatabase.read("policies.json")
        # Check if policy with same title exists
        existing = next((p for p in policies if p["title"].lower() == title.lower()), None)
        if existing:
            existing["content"] = content
            existing["category"] = category
        else:
            new_id = max([p.get("id", 0) for p in policies], default=0) + 1
            policies.append({
                "id": new_id,
                "title": title,
                "category": category,
                "content": content
            })
        JSONDatabase.write("policies.json", policies)
        return True

    @staticmethod
    def search_policies(query):
        policies = JSONDatabase.read("policies.json")
        # Extract keywords longer than 3 characters (or use the whole query if short)
        query_words = [w.lower() for w in query.split() if len(w) > 3]
        if not query_words:
            query_words = [query.lower()]
            
        relevant = []
        for p in policies:
            text = (p["title"] + " " + p["content"]).lower()
            # Score by how many keywords are present
            score = sum(1 for w in query_words if w in text)
            if score > 0:
                relevant.append((score, p))
                
        if not relevant:
            available_titles = "\n".join([f"- {p['title']}" for p in policies])
            return f"No specific policy found for your query. However, here is a list of all available policies:\n{available_titles}\n\nPlease check if any of these match what you are looking for."
        
        # Sort by score descending and take top 3
        relevant.sort(key=lambda x: x[0], reverse=True)
        top_policies = [p for score, p in relevant[:3]]
        
        return "\n\n".join([f"**{p['title']}**\n{p['content']}" for p in top_policies])
