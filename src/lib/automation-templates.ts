export interface AutomationTemplate {
  name: string;
  description: string;
  frequency: "daily" | "weekly" | "monthly";
  day_of_week?: number; // 0=Mon … 6=Sun
  day_of_month?: number;
  hour: number;
  minute: number;
  email_subject: string;
  email_body: string;
}

export interface PortalTemplateConfig {
  accent: string;
  templates: AutomationTemplate[];
}

export const PORTAL_TEMPLATES: Record<string, PortalTemplateConfig> = {
  dashboard: {
    accent: "#00a29a",
    templates: [
      {
        name: "Weekly Company Update",
        description: "Friday digest of news, announcements and events",
        frequency: "weekly", day_of_week: 4, hour: 17, minute: 0,
        email_subject: "This Week at [Company] — Key Updates",
        email_body:
          "Hi Team,\n\nHere's a quick summary of what happened this week:\n\n• [Highlight 1]\n• [Highlight 2]\n• [Highlight 3]\n\nHave a great weekend!\n\n— Admin Team",
      },
      {
        name: "Incident Alert Notification",
        description: "Immediate notice for service outages or critical events",
        frequency: "daily", hour: 8, minute: 0,
        email_subject: "⚠️ Service Incident — Action Required",
        email_body:
          "Hi,\n\nWe are currently experiencing an issue with [System/Service].\n\nStatus: [Investigating / Identified / Resolved]\nImpact: [Brief description]\nETA: [Expected resolution time]\n\nWe'll send updates until resolved.\n\n— IT & Operations",
      },
      {
        name: "Policy Change Notice",
        description: "Formal notification whenever a company policy is updated",
        frequency: "monthly", day_of_month: 1, hour: 10, minute: 0,
        email_subject: "Policy Update: [Policy Name] — Effective [Date]",
        email_body:
          "Dear All,\n\nWe'd like to inform you of an update to our [Policy Name] policy, effective [Date].\n\nKey changes:\n• [Change 1]\n• [Change 2]\n\nPlease read the full policy on the intranet and confirm receipt by [Date].\n\nFor questions, contact HR.\n\n— HR & Compliance",
      },
      {
        name: "Company Event Reminder",
        description: "Monday morning digest of events happening this week",
        frequency: "weekly", day_of_week: 0, hour: 9, minute: 0,
        email_subject: "📅 Upcoming Events This Week",
        email_body:
          "Hi Team,\n\nHere are company events scheduled for this week:\n\n• [Event 1] — [Date, Time, Venue]\n• [Event 2] — [Date, Time, Venue]\n\nPlease confirm attendance via the intranet calendar.\n\n— Admin Team",
      },
    ],
  },

  "analytics-builder": {
    accent: "#6366F1",
    templates: [
      {
        name: "Weekly KPI Digest",
        description: "Monday morning key-metric summary for leadership",
        frequency: "weekly", day_of_week: 0, hour: 8, minute: 0,
        email_subject: "📊 Weekly KPI Digest — Week [#]",
        email_body:
          "Hi Leadership Team,\n\nHere is the KPI summary for the past week:\n\n• Revenue: [Value] vs Target [Target]\n• Active Users: [Value]\n• Ticket Deflection Rate: [Value]%\n• Team Utilization: [Value]%\n\nFull dashboard available in Analytics Studio.\n\n— Analytics Team",
      },
      {
        name: "Monthly Metrics Report",
        description: "First-of-month comprehensive performance overview",
        frequency: "monthly", day_of_month: 1, hour: 9, minute: 0,
        email_subject: "Monthly Metrics Report — [Month Year]",
        email_body:
          "Hi Team,\n\nThe monthly performance report for [Month] is now ready.\n\nHighlights:\n• [Metric 1]: [Value] ([+/-]% vs last month)\n• [Metric 2]: [Value]\n• [Metric 3]: [Value]\n\nKey observations:\n[Summary of trends]\n\nFull report in Analytics Studio.\n\n— Data & Analytics",
      },
      {
        name: "Data Anomaly Alert",
        description: "Daily alert when metrics fall outside expected ranges",
        frequency: "daily", hour: 7, minute: 0,
        email_subject: "⚡ Data Anomaly Detected — Immediate Review Needed",
        email_body:
          "Hi,\n\nAn anomaly was detected in your data:\n\n• Metric: [Metric Name]\n• Expected Range: [Min] – [Max]\n• Actual Value: [Value]\n• Detected at: [Timestamp]\n\nPlease review the Analytics Studio dashboard.\n\n— Automated Monitoring",
      },
    ],
  },

  observability: {
    accent: "#6366F1",
    templates: [
      {
        name: "Weekly AI Usage Digest",
        description: "Friday summary of token consumption and request volume",
        frequency: "weekly", day_of_week: 4, hour: 16, minute: 0,
        email_subject: "AI Usage Report — Week [#]",
        email_body:
          "Hi IT Team,\n\nThis week's AI assistant usage:\n\n• Total Requests: [Count]\n• Total Tokens Used: [Count]\n• Top Consumers: [Dept 1], [Dept 2]\n• Avg Response Time: [X]ms\n• Error Rate: [X]%\n\nFull breakdown in Observability Dashboard.\n\n— Platform Team",
      },
      {
        name: "Token Budget Alert",
        description: "Alert when monthly token usage approaches the budget",
        frequency: "daily", hour: 9, minute: 0,
        email_subject: "⚠️ AI Token Budget Alert — [X]% Used",
        email_body:
          "Hi,\n\nAI token usage has reached [X]% of the monthly budget.\n\n• Budget: [Limit] tokens\n• Used: [Used] tokens\n• Remaining: [Remaining] tokens\n• Days left: [Days]\n\nConsider rate-limiting certain workflows.\n\n— IT Operations",
      },
      {
        name: "Error Spike Notification",
        description: "Alert when AI error rates exceed normal thresholds",
        frequency: "daily", hour: 8, minute: 0,
        email_subject: "🔴 AI Error Spike Detected",
        email_body:
          "Hi Platform Team,\n\nUnusual spike in AI errors detected:\n\n• Error Rate: [X]% (normal: <2%)\n• Affected Endpoints: [List]\n• Time Window: [From] – [To]\n• Most Common Error: [Error type]\n\nCheck AI Observability dashboard for details.\n\n— Automated Alert",
      },
    ],
  },

  "llm-controls": {
    accent: "#F59E0B",
    templates: [
      {
        name: "Model Configuration Update",
        description: "Notify stakeholders when LLM settings are changed",
        frequency: "weekly", day_of_week: 0, hour: 9, minute: 0,
        email_subject: "LLM Configuration Update — [Date]",
        email_body:
          "Hi Team,\n\nAI model configuration changes were made:\n\n• Model: [Previous] → [New]\n• Temperature: [Old] → [New]\n• Max Tokens: [Old] → [New]\n• Reason: [Business justification]\n\nChanges are live. Monitor in Observability Dashboard.\n\n— Platform Engineering",
      },
      {
        name: "Rate Limit Advisory",
        description: "Weekly digest of API rate-limit utilization across teams",
        frequency: "weekly", day_of_week: 4, hour: 15, minute: 0,
        email_subject: "API Rate Limit Weekly Advisory",
        email_body:
          "Hi IT Leadership,\n\nThis week's API rate-limit utilization:\n\n• Peak Usage: [X] req/min (limit: [Y])\n• Teams Near Limit: [Dept 1], [Dept 2]\n• Throttled Requests: [Count]\n\nRecommendation: [Action item]\n\n— IT Operations",
      },
    ],
  },

  "admin-portal": {
    accent: "#00a29a",
    templates: [
      {
        name: "Expense Reimbursement Cut-off",
        description: "Monthly reminder to submit expense claims before cut-off",
        frequency: "monthly", day_of_month: 20, hour: 10, minute: 0,
        email_subject: "⏰ Expense Reimbursement Cut-off — Submit by [Date]",
        email_body:
          "Hi Team,\n\nThe expense reimbursement cut-off for this month is [Date].\n\nTo submit:\n1. Log in to the Admin Portal\n2. Go to Reimbursements\n3. Upload receipts and submit\n\nClaims after [Date] move to next cycle.\n\nQueries? Contact admin@company.com\n\n— Admin Team",
      },
      {
        name: "Parking Sticker Renewal",
        description: "Quarterly reminder for parking allocation renewal",
        frequency: "monthly", day_of_month: 25, hour: 9, minute: 0,
        email_subject: "Parking Sticker Renewal — Action Required",
        email_body:
          "Hi,\n\nYour parking sticker is due for renewal on [Date].\n\nTo renew:\n1. Visit Admin Portal → Parking\n2. Submit your renewal request\n3. Collect new sticker from reception\n\nRenew before [Date] to keep your slot.\n\n— Admin Team",
      },
      {
        name: "Facility Maintenance Notice",
        description: "Advance notice before planned facility downtime",
        frequency: "weekly", day_of_week: 4, hour: 17, minute: 0,
        email_subject: "🔧 Planned Facility Maintenance — [Date]",
        email_body:
          "Hi All,\n\nPlanned maintenance is scheduled for [Date], [Start Time] – [End Time].\n\nAffected areas: [Area 1], [Area 2]\nAlternate arrangements: [Details]\n\nFor queries: facilities@company.com\n\n— Facilities Team",
      },
    ],
  },

  "hr-portal": {
    accent: "#16A34A",
    templates: [
      {
        name: "Leave Approval Pending Reminder",
        description: "Daily nudge to managers with unreviewed leave requests",
        frequency: "daily", hour: 9, minute: 0,
        email_subject: "Pending Leave Requests Awaiting Your Approval",
        email_body:
          "Hi,\n\nYou have pending leave requests that need your approval:\n\n• [Employee Name] — [Leave Type], [Dates]\n• [Employee Name] — [Leave Type], [Dates]\n\nPlease review in the HR Portal at your earliest convenience.\n\n— HR Automation",
      },
      {
        name: "Payroll Processing Notice",
        description: "Monthly alert before payroll close to ensure data accuracy",
        frequency: "monthly", day_of_month: 22, hour: 10, minute: 0,
        email_subject: "⚠️ Payroll Processing — Submit All Changes by [Date]",
        email_body:
          "Hi HR Team,\n\nPayroll processing for [Month] begins on [Date].\n\nEnsure all of the following are updated:\n□ New joiner details\n□ Salary revision approvals\n□ Leave adjustments\n□ Separation settlements\n\nLate submissions won't make this cycle.\n\n— HR Operations",
      },
      {
        name: "Probation Completion Reminder",
        description: "Weekly alert for employees nearing end of probation",
        frequency: "weekly", day_of_week: 0, hour: 8, minute: 0,
        email_subject: "Probation Period Ending — Confirmation Required",
        email_body:
          "Hi HR Team,\n\nThe following employees complete probation within 30 days:\n\n• [Employee Name] — Joining: [Date], Probation Ends: [Date]\n• [Employee Name] — Joining: [Date], Probation Ends: [Date]\n\nPlease initiate confirmation or extension before the end date.\n\n— HR System",
      },
      {
        name: "Year-End Leave Balance Alert",
        description: "Annual reminder for employees to plan remaining leaves",
        frequency: "monthly", day_of_month: 1, hour: 10, minute: 0,
        email_subject: "Year-End Leave Balance — Plan Your Leaves Before [Date]",
        email_body:
          "Hi Team,\n\nThe leave year ends on [Date]. Please check your balance and plan remaining leaves.\n\nUnused leaves beyond the carry-forward limit will lapse.\n\nView balance: HR Portal → My Leaves → Leave Balance\n\nFor queries: hr@company.com\n\n— HR Team",
      },
    ],
  },

  "onboarding-tracker": {
    accent: "#7C3AED",
    templates: [
      {
        name: "New Joiner Welcome",
        description: "Warm welcome on an employee's first day",
        frequency: "daily", hour: 8, minute: 0,
        email_subject: "Welcome to [Company Name]! 🎉",
        email_body:
          "Hi [Employee Name],\n\nWelcome aboard! We're thrilled to have you join the [Team] team.\n\nWhat to expect on your first day:\n• Meet your buddy: [Buddy Name]\n• IT setup: [Location/Link]\n• Induction session: [Time, Location]\n\nYour onboarding checklist: [Onboarding Portal Link]\n\nDon't hesitate to reach out with any questions!\n\n— HR Team",
      },
      {
        name: "Onboarding Document Deadline",
        description: "Reminder for new joiners to submit pending documents",
        frequency: "daily", hour: 10, minute: 0,
        email_subject: "⏳ Pending Onboarding Documents — Submit by [Date]",
        email_body:
          "Hi [Employee Name],\n\nSome onboarding documents are still pending:\n\n□ [Document 1]\n□ [Document 2]\n□ [Document 3]\n\nPlease submit by [Date] to avoid delays.\n\nUpload: [Onboarding Portal Link]\n\nQueries? hr@company.com\n\n— HR Onboarding Team",
      },
      {
        name: "Induction Session Reminder",
        description: "Day-before reminder for scheduled induction sessions",
        frequency: "weekly", day_of_week: 0, hour: 9, minute: 0,
        email_subject: "Reminder: Induction Session Tomorrow — [Date]",
        email_body:
          "Hi [Employee Name],\n\nYour induction session is tomorrow:\n\n📅 Date: [Date]\n⏰ Time: [Time]\n📍 Location: [Venue or Meeting Link]\n\nTopics: Company overview, policies, IT tools, Q&A with leadership.\n\nSee you there!\n\n— HR Team",
      },
    ],
  },

  "it-portal": {
    accent: "#3B82F6",
    templates: [
      {
        name: "Scheduled Maintenance Window",
        description: "Advance notice before planned system downtime",
        frequency: "weekly", day_of_week: 4, hour: 15, minute: 0,
        email_subject: "🔧 Planned Maintenance — [System] | [Date] [Time]",
        email_body:
          "Hi Team,\n\nScheduled maintenance for [System/Service]:\n\n📅 Date: [Date]\n⏰ Duration: [Start] – [End]\nImpact: [Brief description]\n\nPlease save your work and log out before the window.\n\nUrgent support: it-emergency@company.com\n\n— IT Operations",
      },
      {
        name: "Open Ticket Backlog Digest",
        description: "Weekly digest of unresolved tickets by age and priority",
        frequency: "weekly", day_of_week: 0, hour: 8, minute: 0,
        email_subject: "IT Ticket Backlog — Week [#] Review",
        email_body:
          "Hi IT Team,\n\nOpen ticket summary as of [Date]:\n\n• Critical (P1): [Count]\n• High (P2): [Count]\n• Medium (P3): [Count]\n• Aging >7 days: [Count]\n\nTop unresolved:\n1. [Ticket summary]\n2. [Ticket summary]\n\nPrioritize aging tickets. Full report in IT Portal.\n\n— IT Management",
      },
      {
        name: "Security Patch Required",
        description: "Alert employees to apply critical security updates",
        frequency: "weekly", day_of_week: 1, hour: 9, minute: 0,
        email_subject: "🔒 Security Patch Required — Update by [Date]",
        email_body:
          "Hi,\n\nA critical security patch is available for your device.\n\nPatch: [Patch Name / CVE]\nSeverity: [Critical / High]\nDeadline: [Date]\n\nTo apply:\n1. System Settings → Update\n2. Install pending updates\n3. Restart device\n\nUnpatched devices may lose network access after [Date].\n\n— IT Security",
      },
      {
        name: "IT Asset Return Reminder",
        description: "Remind departing employees to return IT equipment",
        frequency: "weekly", day_of_week: 3, hour: 10, minute: 0,
        email_subject: "IT Asset Return — Action Required by [Date]",
        email_body:
          "Hi [Employee Name],\n\nPlease return the following IT assets as part of your [departure/transfer]:\n\n• [Device 1] — Serial: [#]\n• [Device 2] — Serial: [#]\n\nReturn to: [Location]\nDeadline: [Date]\nContact: [IT Contact] | [Email]\n\nEnsure all company data is removed before returning.\n\n— IT Assets Team",
      },
    ],
  },

  "pmo-portal": {
    accent: "#8B5CF6",
    templates: [
      {
        name: "Weekly Delivery Status",
        description: "Monday project health digest for PMO leadership",
        frequency: "weekly", day_of_week: 0, hour: 8, minute: 0,
        email_subject: "Project Delivery Status — Week [#]",
        email_body:
          "Hi PMO Team,\n\nProject status as of [Date]:\n\n🟢 On Track: [Project 1], [Project 2]\n🟡 At Risk: [Project 3] — [Brief reason]\n🔴 Delayed: [Project 4] — [Brief reason]\n\nMilestones due this week:\n• [Project] — [Milestone] by [Date]\n\nFull details in PMO Portal.\n\n— PMO Automation",
      },
      {
        name: "Training Compliance Deadline",
        description: "Alert project members about mandatory training deadlines",
        frequency: "weekly", day_of_week: 1, hour: 9, minute: 0,
        email_subject: "⚠️ Mandatory Training Due — Complete by [Date]",
        email_body:
          "Hi Team,\n\nMandatory training deadline is approaching:\n\nTraining: [Training Name]\nDeadline: [Date]\nTeam completion: [X]%\n\nYet to complete:\n• [Name 1]\n• [Name 2]\n\nComplete via TechElevate LMS or Udemy Business.\n\n— PMO & L&D Team",
      },
      {
        name: "Resource Utilization Report",
        description: "Monthly utilization digest for allocation and bench management",
        frequency: "monthly", day_of_month: 1, hour: 9, minute: 0,
        email_subject: "Resource Utilization Report — [Month Year]",
        email_body:
          "Hi PMO Leadership,\n\nResource utilization for [Month]:\n\n• Billable Utilization: [X]%\n• Bench Headcount: [Count]\n• Upcoming Rolloffs: [Count]\n• Skill Gaps: [X]\n\nTop underutilized skills: [Skill 1], [Skill 2]\n\nFull report in PMO Portal → Resource Planning.\n\n— PMO Analytics",
      },
    ],
  },

  "leadership-command": {
    accent: "#06B6D4",
    templates: [
      {
        name: "Workforce Readiness Digest",
        description: "Weekly capability and pipeline readiness for leadership",
        frequency: "weekly", day_of_week: 0, hour: 7, minute: 0,
        email_subject: "Workforce Readiness Digest — Week [#]",
        email_body:
          "Hi Leadership Team,\n\nWorkforce readiness as of [Date]:\n\n• Readiness Score: [X]/100\n• Critical Skill Gaps: [X]\n• SPOF Risks: [X] roles\n• Bench Available: [Count]\n• Attrition Risk: [X] flagged\n\nTop priorities:\n1. [Action 1]\n2. [Action 2]\n\nFull breakdown in Capability Command.\n\n— Workforce Intelligence",
      },
      {
        name: "Critical SPOF Alert",
        description: "Immediate alert when single-point-of-failure risks are detected",
        frequency: "weekly", day_of_week: 1, hour: 8, minute: 0,
        email_subject: "🚨 SPOF Risk Alert — Action Required",
        email_body:
          "Hi Leadership,\n\nCritical SPOF risks identified:\n\n• Role: [Role Name] — Only [Name] holds this expertise\n• Domain: [Skill]\n• Risk: [High / Critical]\n• Project dependency: [Project Name]\n\nRecommended actions:\n1. Knowledge transfer to [Backup]\n2. Hire/cross-train backup\n3. Document critical processes\n\n— Workforce Intelligence",
      },
      {
        name: "Monthly Bench Cost Summary",
        description: "Monthly cost report for bench and unallocated resources",
        frequency: "monthly", day_of_month: 5, hour: 9, minute: 0,
        email_subject: "Bench Cost Report — [Month Year]",
        email_body:
          "Hi Finance & PMO,\n\nBench summary for [Month]:\n\n• Total Bench: [Count]\n• Estimated Cost: ₹[Amount]\n• Avg Bench Duration: [X] days\n• Highest bench skills: [Skill 1], [Skill 2]\n• Ready to deploy: [Count]\n\nFull analysis in Capability Command → Bench Report.\n\n— PMO Finance",
      },
    ],
  },

  "project-iq": {
    accent: "#0EA5E9",
    templates: [
      {
        name: "Similar Project Alert",
        description: "Notify PMs when IQ finds relevant historical projects",
        frequency: "weekly", day_of_week: 1, hour: 9, minute: 0,
        email_subject: "Project IQ: Similar Past Projects for [Project Name]",
        email_body:
          "Hi Project Team,\n\nProject IQ found relevant past projects for [Project Name]:\n\n1. [Past Project 1] — [Relevance reason]\n2. [Past Project 2] — [Relevance reason]\n\nKey lessons:\n• [Lesson 1]\n• [Lesson 2]\n\nExperts: [Expert 1], [Expert 2]\n\nFull details in Project IQ.\n\n— PMO Knowledge System",
      },
      {
        name: "Lessons Learned Weekly Digest",
        description: "Weekly compilation of lessons from recently closed projects",
        frequency: "weekly", day_of_week: 4, hour: 16, minute: 0,
        email_subject: "Project Lessons Learned — Week [#]",
        email_body:
          "Hi PMO Team,\n\nLessons from projects closed this week:\n\n• [Project 1]\n  - What worked: [Insight]\n  - Improve next time: [Insight]\n\n• [Project 2]\n  - What worked: [Insight]\n  - Improve next time: [Insight]\n\nAdded to Project IQ for future reference.\n\n— PMO Knowledge Management",
      },
      {
        name: "Reusable Asset Notification",
        description: "Alert teams when relevant reusable assets are available",
        frequency: "weekly", day_of_week: 1, hour: 10, minute: 0,
        email_subject: "Reusable Assets Available for [Project Name]",
        email_body:
          "Hi [PM Name],\n\nProject IQ found reusable assets for your current project:\n\n• [Asset 1] — [Type: Template/Code/Document]\n• [Asset 2] — [Type: Template/Code/Document]\n\nEstimated time saving: ~[X] hours\n\nAccess: Project IQ → Asset Library\n\n— PMO Knowledge System",
      },
    ],
  },

  "te-lms": {
    accent: "#7C3AED",
    templates: [
      {
        name: "Training Assignment Notice",
        description: "Notify employees when a new training is assigned",
        frequency: "daily", hour: 9, minute: 0,
        email_subject: "New Training Assigned: [Training Name]",
        email_body:
          "Hi [Employee Name],\n\nA new training has been assigned to you:\n\n📚 Training: [Training Name]\n⏱ Duration: [X] hours\n📅 Due Date: [Date]\n🎯 Required for: [Role / Project / Compliance]\n\nStart here: TechElevate LMS → My Trainings\n\nCompletion earns a verified skill badge.\n\n— L&D Team",
      },
      {
        name: "Assessment Due Reminder",
        description: "Reminder for employees with pending LMS assessments",
        frequency: "weekly", day_of_week: 1, hour: 9, minute: 0,
        email_subject: "⏰ Assessment Due — [Training Name]",
        email_body:
          "Hi [Employee Name],\n\nYour assessment for [Training Name] is due on [Date].\n\n• Progress: [X]%\n• Deadline: [Date]\n• Passing score: [X]%\n\nPassing earns a verified skill certification.\n\nTake the assessment: TechElevate LMS → My Trainings → [Training] → Assessment\n\n— L&D Team",
      },
      {
        name: "Team Learning Digest",
        description: "Weekly summary of team completions and pending courses",
        frequency: "weekly", day_of_week: 4, hour: 17, minute: 0,
        email_subject: "Team Learning Digest — Week [#]",
        email_body:
          "Hi [Manager Name],\n\nTeam learning activity this week:\n\n✅ Completed:\n• [Employee 1] — [Course Name]\n• [Employee 2] — [Course Name]\n\n🔄 In Progress:\n• [Employee 3] — [Course Name] ([X]%)\n\n⚠️ Overdue:\n• [Employee 4] — [Course Name] (Due: [Date])\n\nFull report: TechElevate LMS → Team Report\n\n— L&D Automation",
      },
    ],
  },

  "udemy-business": {
    accent: "#A435F0",
    templates: [
      {
        name: "Inactive Learner Reminder",
        description: "Weekly nudge to employees inactive on Udemy Business",
        frequency: "weekly", day_of_week: 1, hour: 9, minute: 0,
        email_subject: "Continue Your Learning on Udemy Business 📚",
        email_body:
          "Hi [Employee Name],\n\nYou haven't accessed Udemy Business in [X] days.\n\nYour company provides full access to thousands of courses — make the most of it!\n\nRecommended for you:\n• [Course 1] — Based on your role\n• [Course 2] — Trending in your department\n\nLog in: [Udemy Business Link]\n\nEven 15 minutes/day makes a difference.\n\n— L&D Team",
      },
      {
        name: "New Catalog Additions",
        description: "Monthly digest of newly added courses relevant to the team",
        frequency: "monthly", day_of_month: 1, hour: 10, minute: 0,
        email_subject: "New Courses on Udemy Business — [Month]",
        email_body:
          "Hi Team,\n\nNew courses added to Udemy Business this month:\n\n🆕 New Additions:\n• [Course 1] — [Duration] | ⭐ [Rating]\n• [Course 2] — [Duration] | ⭐ [Rating]\n• [Course 3] — [Duration] | ⭐ [Rating]\n\nBrowse: [Udemy Business Link]\n\nHappy learning!\n\n— L&D Team",
      },
      {
        name: "License Utilization Alert",
        description: "Monthly alert for admins on seat usage and idle accounts",
        frequency: "monthly", day_of_month: 15, hour: 9, minute: 0,
        email_subject: "Udemy Business License Utilization — [Month]",
        email_body:
          "Hi L&D Admin,\n\nUdemy Business license utilization for [Month]:\n\n• Total Licenses: [Count]\n• Active Users: [Count] ([X]%)\n• Inactive (30+ days): [Count]\n• Courses Completed: [Count]\n• Avg Hours/Active User: [X] hrs\n\nInactive seats are under review for reallocation.\n\nFull details: Udemy Business Admin → Reports\n\n— L&D Analytics",
      },
    ],
  },

  "role-control": {
    accent: "#F59E0B",
    templates: [
      {
        name: "Quarterly Access Review",
        description: "Quarterly reminder for managers to verify team access",
        frequency: "monthly", day_of_month: 1, hour: 9, minute: 0,
        email_subject: "Action Required: Quarterly Access Review — [Q] [Year]",
        email_body:
          "Hi Manager,\n\nTime for the quarterly access review. Please verify your team's access.\n\nYour team to review:\n• [Employee 1] — Role: [Role], Portals: [List]\n• [Employee 2] — Role: [Role], Portals: [List]\n\nAction required:\n□ Remove access for departed/transferred employees\n□ Update role changes\n□ Confirm current access is appropriate\n\nReview in: Access Management Portal\n\n— IT Security & Compliance",
      },
      {
        name: "Role Change Notification",
        description: "Immediate notification when a user's role is modified",
        frequency: "daily", hour: 10, minute: 0,
        email_subject: "Access Role Updated — [Employee Name]",
        email_body:
          "Hi [Employee Name],\n\nYour system access has been updated:\n\n• Previous Role: [Old Role]\n• New Role: [New Role]\n• Effective: [Date]\n• Updated by: [Admin Name]\n\nNew access:\n+ [Portal 1]\n+ [Portal 2]\n\nRemoved access:\n- [Portal 3]\n\nQuestions? Contact IT Support.\n\n— IT Security Team",
      },
    ],
  },
};
