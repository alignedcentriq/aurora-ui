import json
import random
import datetime
import os

def generate_data():
    departments = ["Engineering", "HR", "IT", "Marketing", "Sales", "Finance", "Product"]
    locations = ["Mumbai", "Bangalore", "Gurgaon", "Pune", "Hyderabad"]
    designations = {
        "Engineering": ["SDE I", "SDE II", "Senior SDE", "Engineering Manager"],
        "HR": ["HR Associate", "HR Manager", "Talent Acquisition"],
        "IT": ["IT Support", "System Admin", "Security Analyst"],
        "Finance": ["Accountant", "Finance Manager"],
        "Product": ["Product Manager", "UI/UX Designer"]
    }

    # Generate Employees
    employees = []
    for i in range(1, 51):
        dept = random.choice(departments)
        desig = random.choice(designations.get(dept, ["Associate"]))
        
        emp = {
            "id": i,
            "employee_id": f"EMP{1000+i}",
            "name": f"Employee {i}",
            "email": f"employee{i}@centriq.ai",
            "department": dept,
            "designation": desig,
            "joining_date": str(datetime.date(2022, 1, 1) + datetime.timedelta(days=random.randint(0, 365*2))),
            "employment_type": "Full-time",
            "location": random.choice(locations),
            "pf_number": f"PF{random.randint(100000, 999999)}",
            "insurance_plan": random.choice(["Gold", "Silver", "Platinum"]),
            "tax_regime": random.choice(["Old", "New"]),
            "shift_type": "Day"
        }
        employees.append(emp)

    # Generate Leaves
    leaves = []
    for i in range(1, 11): # Leaves for first 10 employees
        for j in range(3):
            leaves.append({
                "id": len(leaves) + 1,
                "employee_id": i,
                "leave_type": random.choice(["Casual", "Sick", "Earned"]),
                "start_date": str(datetime.date.today() - datetime.timedelta(days=random.randint(5, 30))),
                "end_date": str(datetime.date.today() - datetime.timedelta(days=random.randint(1, 4))),
                "status": random.choice(["Approved", "Pending", "Rejected"]),
                "reason": "Personal work"
            })

    # Generate Payroll
    payroll = []
    for emp in employees:
        base = random.randint(50000, 150000)
        bonus = random.randint(0, 10000)
        tax = base * 0.1
        payroll.append({
            "id": emp["id"],
            "employee_id": emp["id"],
            "month": datetime.date.today().month,
            "year": datetime.date.today().year,
            "base_salary": base,
            "bonus": bonus,
            "deductions": tax,
            "net_salary": base + bonus - tax,
            "tax_paid": tax,
            "status": "Paid"
        })

    # Generate Policies
    policies = [
        {"id": 1, "title": "Leave Policy", "category": "Leave", "content": "Employees are entitled to 20 days of Earned Leave per year. Sick leave is capped at 12 days."},
        {"id": 2, "title": "WFH Policy", "category": "Work", "content": "Hybrid model: 3 days from office, 2 days from home."},
        {"id": 3, "title": "Reimbursement Policy", "category": "Finance", "content": "Expenses up to $500 can be approved by managers. Higher amounts require Finance VP approval."},
        {"id": 4, "title": "POSH Policy", "category": "Legal", "content": "Zero tolerance for harassment. Reach out to the IC committee for any concerns."}
    ]

    # Save to JSON files
    data_path = "backend/data"
    os.makedirs(data_path, exist_ok=True)
    
    with open(f"{data_path}/employees.json", "w") as f:
        json.dump(employees, f, indent=2)
    with open(f"{data_path}/leaves.json", "w") as f:
        json.dump(leaves, f, indent=2)
    with open(f"{data_path}/payroll.json", "w") as f:
        json.dump(payroll, f, indent=2)
    with open(f"{data_path}/policies.json", "w") as f:
        json.dump(policies, f, indent=2)

    print(f"✅ JSON data generated in {data_path}/")

if __name__ == "__main__":
    generate_data()
