# Model Performance Benchmark Comparison

| Scenario | Query | gpt-oss:latest (Old) Status | gpt-oss Time (s) | qwen2.5:14b (New) Status | qwen2.5 Time (s) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| IT - Software Request (Tool Call) | `Can you install Python for me?` | PASS | 11.46s | PASS | 7.61s |
| IT - Issue Reporting (Tool Call) | `My monitor is flickering and won't turn on since morning` | PASS | 2.40s | PASS | 4.56s |
| Admin - Parking Sticker Request (Missing Param handling) | `I need a parking sticker for my Honda Swift car` | FAIL | 1.81s | PASS | 1.35s |
| Admin - Reimbursement Check (Keyword Search Rule) | `I spent 5000 rupees on travel yesterday, submit a claim` | PASS | 2.61s | FAIL | 2.65s |
| General - Greeting (Conversational response) | `Hi, who are you and how can you help me today?` | PASS | 2.58s | PASS | 3.07s |


## Detailed Responses Comparison
### Scenario 1: IT - Software Request (Tool Call)
**Query:** `Can you install Python for me?`

#### 🤖 gpt-oss:latest (Old)
- **Time taken:** 11.46s
- **Status:** PASS
- **Tool Calls:** `[{'name': 'request_software_install', 'args': {'software_name': 'Python'}, 'id': 'call_6m68kmd3', 'type': 'tool_call'}]`
- **Content:** 

#### 🚀 qwen2.5:14b (New)
- **Time taken:** 7.61s
- **Status:** PASS
- **Tool Calls:** `[{'name': 'request_software_install', 'args': {'software_name': 'Python'}, 'id': 'call_an27kore', 'type': 'tool_call'}]`
- **Content:** 

---
### Scenario 2: IT - Issue Reporting (Tool Call)
**Query:** `My monitor is flickering and won't turn on since morning`

#### 🤖 gpt-oss:latest (Old)
- **Time taken:** 2.40s
- **Status:** PASS
- **Tool Calls:** `[{'name': 'create_it_ticket', 'args': {'category': 'Hardware', 'description': "Monitor is flickering and won't turn on since morning.", 'priority': 'High', 'subject': 'Monitor not turning on and flickering'}, 'id': 'call_p0fqpegm', 'type': 'tool_call'}]`
- **Content:** 

#### 🚀 qwen2.5:14b (New)
- **Time taken:** 4.56s
- **Status:** PASS
- **Tool Calls:** `[{'name': 'create_it_ticket', 'args': {'category': 'Hardware', 'description': "My monitor is flickering and won't turn on since morning.", 'priority': 'High', 'subject': 'Flickering Monitor'}, 'id': 'call_9zf1d3e7', 'type': 'tool_call'}]`
- **Content:** คณะกรรมการทำ IT ticket สำหรับปัญหานี้ เนื่องจากมอนิเตอร์ของคุณไม่สามารถเปิดทำงานได้และกระพริบตั้งแต่เช้า



---
### Scenario 3: Admin - Parking Sticker Request (Missing Param handling)
**Query:** `I need a parking sticker for my Honda Swift car`

#### 🤖 gpt-oss:latest (Old)
- **Time taken:** 1.81s
- **Status:** FAIL
- **Tool Calls:** `None`
- **Content:** Sure thing! To get your parking sticker, I’ll need your vehicle’s registration number (the number plate). Could you please provide that?

#### 🚀 qwen2.5:14b (New)
- **Time taken:** 1.35s
- **Status:** PASS
- **Tool Calls:** `None`
- **Content:** Sure, I can help with that. Could you please provide me with the vehicle number of your Honda Swift?

---
### Scenario 4: Admin - Reimbursement Check (Keyword Search Rule)
**Query:** `I spent 5000 rupees on travel yesterday, submit a claim`

#### 🤖 gpt-oss:latest (Old)
- **Time taken:** 2.61s
- **Status:** PASS
- **Tool Calls:** `[{'name': 'submit_reimbursement', 'args': {'amount': 5000, 'reason': 'travel', 'type': 'travel'}, 'id': 'call_dunfkh9j', 'type': 'tool_call'}]`
- **Content:** 

#### 🚀 qwen2.5:14b (New)
- **Time taken:** 2.65s
- **Status:** FAIL
- **Tool Calls:** `None`
- **Content:** Could you please specify the exact amount you are claiming for reimbursement from the total 5000 rupees spent on travel? If it's the full amount, I'll proceed with that. Please provide any additional details or documentation if required by our policy.

---
### Scenario 5: General - Greeting (Conversational response)
**Query:** `Hi, who are you and how can you help me today?`

#### 🤖 gpt-oss:latest (Old)
- **Time taken:** 2.58s
- **Status:** PASS
- **Tool Calls:** `None`
- **Content:** Hello! I’m **Centriq**, your friendly AI assistant here at Aligned Automation. I’m designed to help you with a wide range of HR, IT, and administrative questions—whether you need help with benefits, onboarding, tech support, office policies, or anything else that keeps the workplace running smoothly. Just let me know what you’re looking for, and I’ll do my best to assist you!

#### 🚀 qwen2.5:14b (New)
- **Time taken:** 3.07s
- **Status:** PASS
- **Tool Calls:** `None`
- **Content:** Hello! I'm Centriq, your friendly AI assistant from Aligned Automation. I'm here to assist you with a variety of tasks related to HR, IT, and general admin support. Whether you need information about company policies, technical assistance, or help organizing your schedule, feel free to ask me anything! How can I be of service today?

---
