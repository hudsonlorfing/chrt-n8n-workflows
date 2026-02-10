-- =============================================================================
-- Seed: analysis_templates
-- Generated from configs/ai-apps/*.json
-- =============================================================================

insert into analysis_templates (id, name, category, icon, description, auto_detect, scoring, extraction_targets, output_schema, system_prompt, extra) values

-- 1. executive-strategy
(
  'executive-strategy',
  'Executive Strategy Session',
  'strategy',
  '🎯',
  'Analysis for CEO/executive-level strategy discussions covering pricing, organizational structure, business strategy, and leadership decisions',
  '{"title_keywords":["strategy","pricing","organizational","leadership","executive","board","ceo","cfo","coo","founder"],"external_required":false,"content_signals":["pricing","revenue","profitability","margins","MRR","ARR","organizational","team structure","headcount","hiring","strategy","roadmap","vision","mission","core values","leadership","culture","incentives","compensation","clients","customers","churn","retention","growth","onboarding","setup fee","maintenance","custom work","budget","forecast","runway","burn rate"],"duration_min":60,"fallback":false}'::jsonb,
  null,
  '[{"field":"strategic_decisions","prompt":"What strategic decisions were made or discussed? Include rationale and expected impact."},{"field":"pricing_strategy","prompt":"What pricing discussions occurred? Include current pricing, proposed changes, and impact analysis."},{"field":"organizational_changes","prompt":"What organizational structure or team changes were discussed? Include roles, responsibilities, and reporting changes."},{"field":"financial_metrics","prompt":"What financial metrics, KPIs, or performance data was discussed? Include specific numbers."},{"field":"customer_insights","prompt":"What customer-related insights were shared? Include retention, churn, satisfaction, and segment analysis."},{"field":"action_items","prompt":"What action items were agreed upon? Include owner, deadline, and priority."},{"field":"key_quotes","prompt":"What notable quotes or statements capture important strategic thinking?"},{"field":"risks_concerns","prompt":"What risks, concerns, or challenges were raised?"},{"field":"next_steps","prompt":"What follow-up meetings, analyses, or decisions are planned?"}]'::jsonb,
  '{"format":"markdown","sections":["## Executive Summary","{{executive_summary}}","## Strategic Decisions","{{strategic_decisions}}","## Pricing Strategy","{{pricing_strategy}}","## Organizational Discussions","{{organizational_changes}}","## Financial Metrics & KPIs","{{financial_metrics}}","## Customer Insights","{{customer_insights}}","## Risks & Concerns","{{risks_concerns}}","## Action Items","| Action | Owner | Priority | Deadline |","|--------|-------|----------|----------|","{{action_items_table}}","## Key Quotes","{{key_quotes}}","## Next Steps","{{next_steps}}"]}'::jsonb,
  E'You are a strategic advisor analyzing an executive-level meeting. This meeting involves leadership discussing critical business decisions. Focus on:\n\n1. **Strategic Clarity**: Extract clear decisions and their rationale\n2. **Financial Impact**: Capture all numbers, metrics, and financial implications\n3. **Organizational Impact**: Note any changes to team structure, roles, or culture\n4. **Actionable Insights**: Ensure every action item has an owner and timeline\n5. **Institutional Knowledge**: Preserve wisdom and context that informs strategy\n\nBe thorough - executive meetings often contain critical context that affects multiple business areas. Attribute insights to specific speakers when possible. Output structured markdown.',
  null
),

-- 2. discovery-scorecard
(
  'discovery-scorecard',
  'Discovery Call Scorecard',
  'sales',
  '🔍',
  'Evaluate discovery call quality with structured scoring rubric',
  '{"title_keywords":["discovery","intro","initial","first call","connect","learn more"],"title_negative":["demo","pricing","contract","internal"],"external_required":true,"content_signals":["tell me about","current process","what are you using","challenges"]}'::jsonb,
  '{"enabled":true,"max_score":6,"pass_threshold":4,"criteria":[{"id":"agenda","name":"Set Agenda","weight":1,"question":"Did the rep clearly set an agenda at the start of the call?"},{"id":"business_need","name":"Business Need","weight":1,"question":"Did the rep spend time understanding the prospect''s business need?"},{"id":"pain_point","name":"Pain Point","weight":1,"question":"Did the rep identify and probe on specific pain points?"},{"id":"competitors","name":"Competitors","weight":1,"question":"Did the rep ask about competitors or current solutions?"},{"id":"timeline","name":"Timeline/Urgency","weight":1,"question":"Did the rep establish timeline or urgency?"},{"id":"next_steps","name":"Next Steps","weight":1,"question":"Did the rep set clear, specific next steps?"}]}'::jsonb,
  '[{"field":"prospect_situation","prompt":"Summarize the prospect''s current situation and context"},{"field":"pain_points","prompt":"List all pain points mentioned, with severity (high/medium/low)"},{"field":"current_solution","prompt":"What solution are they currently using? How satisfied are they?"},{"field":"decision_process","prompt":"Who else is involved in the decision? What''s the process?"},{"field":"timeline","prompt":"What''s their timeline for making a decision or implementing?"},{"field":"budget_signals","prompt":"Any mentions of budget, pricing sensitivity, or financial constraints?"}]'::jsonb,
  '{"format":"markdown","sections":["## Discovery Score: {{score}}/6 {{grade}}","### Scorecard","| Criteria | Score | Evidence |","|----------|-------|----------|","{{criteria_table}}","### Situation Summary","{{prospect_situation}}","### Pain Points Identified","{{pain_points}}","### Current Solution","{{current_solution}}","### Decision Process","{{decision_process}}","### Timeline & Urgency","{{timeline}}","### Coaching Notes","{{coaching_feedback}}"]}'::jsonb,
  E'You are an expert sales performance analyst evaluating a discovery call. Your job is to score the call against best practices and extract key qualification data.\n\nFor each scoring criterion, provide:\n- Score: 1 (met) or 0 (not met)\n- Timestamp: When it occurred (if applicable)\n- Evidence: Brief quote or description\n\nBe specific and evidence-based. If something wasn''t covered, note it as a coaching opportunity.\n\nOutput valid JSON matching the schema.',
  null
),

-- 3. demo-scorecard
(
  'demo-scorecard',
  'Demo Scorecard',
  'sales',
  '🎯',
  'Evaluate demo performance against best practices rubric',
  '{"title_keywords":["demo","presentation","walkthrough","platform overview","show","product tour"],"title_negative":["discovery","internal","sync"],"external_required":true,"content_signals":["let me show you","this is how","here you can see","feature"]}'::jsonb,
  '{"enabled":true,"max_score":6,"pass_threshold":4,"criteria":[{"id":"agenda","name":"Set Agenda","weight":1,"question":"Did the rep set an agenda for the demo?"},{"id":"business_need","name":"Business Need","weight":1,"question":"Did the rep confirm/revisit the business need before demoing?"},{"id":"pain_point","name":"Pain Point","weight":1,"question":"Did the rep tie features back to the prospect''s specific pain points?"},{"id":"competitors","name":"Competitors","weight":1,"question":"Did the rep ask about or address competitor comparisons?"},{"id":"pricing","name":"Pricing","weight":1,"question":"Did the rep discuss pricing or investment?"},{"id":"clarifying_qs","name":"Clarifying Questions","weight":1,"question":"Did the rep ask clarifying questions during the demo?"}]}'::jsonb,
  '[{"field":"features_shown","prompt":"List all features demonstrated with prospect reactions"},{"field":"objections_raised","prompt":"List any objections or concerns raised during the demo"},{"field":"questions_asked","prompt":"What questions did the prospect ask? What does this reveal about their priorities?"},{"field":"engagement_level","prompt":"Rate prospect engagement (high/medium/low) with evidence"},{"field":"buying_signals","prompt":"Identify any buying signals or expressions of interest"},{"field":"next_steps","prompt":"What next steps were agreed upon?"}]'::jsonb,
  '{"format":"markdown","sections":["## Demo Score: {{score}}/6 {{grade}}","### Scorecard","| Criteria | Score | Timestamp | Evidence |","|----------|-------|-----------|----------|","{{criteria_table}}","### Features Demonstrated","{{features_shown}}","### Objections & Concerns","{{objections_raised}}","### Prospect Questions","{{questions_asked}}","### Buying Signals","{{buying_signals}}","### Next Steps","{{next_steps}}","### Coaching Notes","{{coaching_feedback}}"]}'::jsonb,
  E'You are an expert sales coach evaluating a product demo. Score the demo against the rubric and identify coaching opportunities.\n\nFocus on:\n1. Did the rep customize the demo to the prospect''s needs?\n2. Did the rep handle objections effectively?\n3. Did the rep create urgency and move toward next steps?\n\nBe specific with timestamps and quotes. Output valid JSON.',
  null
),

-- 4. spiced-analyzer
(
  'spiced-analyzer',
  'SPICED Analyzer',
  'sales',
  '🌶️',
  'Extract and score SPICED qualification framework elements',
  '{"title_keywords":["discovery","qualification","sales","prospect"],"external_required":true,"content_signals":["situation","problem","impact","timeline","decision"]}'::jsonb,
  '{"enabled":true,"max_score":6,"pass_threshold":4,"criteria":[{"id":"situation","name":"Situation","weight":1,"question":"Is the prospect''s current situation/context clearly understood?"},{"id":"pain","name":"Pain","weight":1,"question":"Are specific pain points identified and quantified?"},{"id":"impact","name":"Impact","weight":1,"question":"Is the business impact of the pain understood (cost, time, risk)?"},{"id":"critical_event","name":"Critical Event","weight":1,"question":"Is there a compelling event or deadline driving urgency?"},{"id":"decision","name":"Decision","weight":1,"question":"Is the decision criteria understood (what matters most)?"},{"id":"decision_process","name":"Decision Process","weight":1,"question":"Is the decision process mapped (who, steps, timeline)?"}]}'::jsonb,
  '[{"field":"situation","prompt":"Describe the prospect''s current situation, environment, and context. What''s their business? What tools/processes are they using?"},{"field":"pain","prompt":"List all pain points with severity. What are they struggling with? What''s broken or frustrating?"},{"field":"impact","prompt":"Quantify the impact of the pain. Cost? Time wasted? Revenue lost? Risk exposure?"},{"field":"critical_event","prompt":"What''s the compelling event? Deadline? Trigger? Why now?"},{"field":"decision_criteria","prompt":"What criteria will they use to make the decision? What matters most?"},{"field":"decision_process","prompt":"Who''s involved? What are the steps? Timeline? Budget approval process?"},{"field":"champion","prompt":"Is there an internal champion? Who''s advocating for change?"}]'::jsonb,
  '{"format":"markdown","sections":["## SPICED Score: {{score}}/6","### Framework Analysis","| Element | Status | Confidence | Notes |","|---------|--------|------------|-------|","{{spiced_table}}","### S - Situation","{{situation}}","### P - Pain","{{pain}}","### I - Impact","{{impact}}","### C - Critical Event","{{critical_event}}","### E - Decision Criteria","{{decision_criteria}}","### D - Decision Process","{{decision_process}}","### Champion Status","{{champion}}","### Gaps to Address","{{gaps}}"]}'::jsonb,
  E'You are a SPICED methodology expert analyzing a sales conversation. Extract each SPICED element with supporting evidence.\n\nFor each element:\n- Status: Confirmed / Partially Confirmed / Unknown / Not Discussed\n- Confidence: High / Medium / Low\n- Evidence: Specific quotes or context\n\nIdentify gaps where the rep should probe deeper in follow-up calls. Output valid JSON.',
  null
),

-- 5. objection-handler
(
  'objection-handler',
  'Objection Handler',
  'sales',
  '🛡️',
  'Detect and analyze objections with response effectiveness scoring',
  '{"title_keywords":["demo","pricing","negotiation","proposal","close"],"external_required":true,"content_signals":["concern","worried","expensive","competitor","not sure","hesitant"]}'::jsonb,
  '{"enabled":true,"max_score":5,"criteria":[{"id":"acknowledge","name":"Acknowledge","weight":1,"question":"Did rep acknowledge the objection?"},{"id":"clarify","name":"Clarify","weight":1,"question":"Did rep ask clarifying questions?"},{"id":"respond","name":"Respond","weight":1,"question":"Did rep provide a substantive response?"},{"id":"confirm","name":"Confirm","weight":1,"question":"Did rep confirm the concern was addressed?"},{"id":"advance","name":"Advance","weight":1,"question":"Did rep advance the conversation forward?"}]}'::jsonb,
  '[{"field":"objections","prompt":"List each objection raised with category (Pricing/Competitor/Feature/Trust/Timing/Authority)"},{"field":"rep_responses","prompt":"How did the rep respond to each objection?"},{"field":"resolution_status","prompt":"Was each objection resolved, deferred, or left unaddressed?"},{"field":"sentiment_shift","prompt":"Did the prospect''s sentiment change after the response?"}]'::jsonb,
  '{"format":"markdown","sections":["## Objection Analysis","### Objections Detected: {{count}}","| Category | Objection | Rep Response | Resolution | Effectiveness |","|----------|-----------|--------------|------------|---------------|","{{objections_table}}","### Coaching Tips","{{coaching_feedback}}","### Suggested Responses","{{suggested_responses}}"]}'::jsonb,
  E'You are a sales objection handling expert. Identify every objection in the conversation and analyze how effectively it was handled.\n\nFor each objection:\n1. Category (Pricing/Competitor/Feature/Trust/Timing/Authority)\n2. Exact quote or paraphrase\n3. Rep''s response\n4. Resolution status (Resolved/Deferred/Unaddressed)\n5. Effectiveness rating (1-5)\n\nProvide coaching tips for unresolved objections. Output valid JSON.',
  '{"objection_categories":[{"id":"pricing","name":"Pricing","keywords":["expensive","cost","budget","price","cheaper","discount"]},{"id":"competitor","name":"Competitor","keywords":["using","competitor","alternative","they offer","compared to"]},{"id":"feature","name":"Feature Gap","keywords":["missing","doesn''t have","need","can''t do","limitation"]},{"id":"trust","name":"Trust/Risk","keywords":["unsure","risk","proven","references","case study","guarantee"]},{"id":"timing","name":"Timing","keywords":["not now","later","next quarter","busy","priority"]},{"id":"authority","name":"Authority","keywords":["need to check","boss","approval","committee","not my decision"]}]}'::jsonb
),

-- 6. competitor-tracker
(
  'competitor-tracker',
  'Competitor Tracker',
  'sales',
  '🎯',
  'Track competitor mentions and comparison insights',
  '{"title_keywords":["discovery","demo","evaluation","comparison"],"external_required":true,"content_signals":["using","looked at","compared","alternative","competitor"]}'::jsonb,
  null,
  '[{"field":"competitors_mentioned","prompt":"List all competitors mentioned by name"},{"field":"current_solution","prompt":"What solution is the prospect currently using?"},{"field":"comparison_points","prompt":"What specific features or capabilities were compared?"},{"field":"competitor_strengths","prompt":"What did the prospect say competitors do well?"},{"field":"competitor_weaknesses","prompt":"What frustrations did they express about competitors?"},{"field":"switching_barriers","prompt":"What barriers to switching were mentioned?"},{"field":"differentiation_opportunities","prompt":"Where can we differentiate based on this conversation?"}]'::jsonb,
  '{"format":"markdown","sections":["## Competitor Intelligence","### Competitors Mentioned","{{competitors_list}}","### Current Solution","{{current_solution}}","### Comparison Matrix","| Feature/Capability | Us | Competitor | Prospect Preference |","|-------------------|-----|------------|---------------------|","{{comparison_table}}","### Competitor Strengths","{{competitor_strengths}}","### Competitor Weaknesses (Our Opportunities)","{{competitor_weaknesses}}","### Switching Barriers","{{switching_barriers}}","### Battle Card Insights","{{differentiation_opportunities}}"]}'::jsonb,
  E'You are a competitive intelligence analyst. Extract all competitor-related insights from this sales conversation.\n\nListen for:\n- Direct competitor mentions\n- Feature comparisons\n- Pricing comparisons\n- Satisfaction/dissatisfaction with current solution\n- Switching considerations\n\nProvide actionable insights for differentiation. Output valid JSON.',
  null
),

-- 7. churn-risk-analyzer
(
  'churn-risk-analyzer',
  'Churn Risk Analyzer',
  'customer_success',
  '⚠️',
  'Detect churn signals and customer health indicators',
  '{"title_keywords":["check-in","review","qbr","renewal","support"],"external_required":true,"content_signals":["cancel","unhappy","frustrated","not using","looking at","alternative"]}'::jsonb,
  '{"enabled":true,"max_score":10,"type":"health_score","indicators":{"positive":[{"signal":"Expansion discussion","points":2},{"signal":"Referral offer","points":2},{"signal":"Positive feedback","points":1},{"signal":"High usage mentioned","points":1},{"signal":"Long-term planning","points":1}],"negative":[{"signal":"Cancellation mention","points":-3},{"signal":"Competitor mention","points":-2},{"signal":"Low usage complaint","points":-2},{"signal":"Unresolved issue","points":-1},{"signal":"Budget concerns","points":-1}]}}'::jsonb,
  '[{"field":"sentiment_overall","prompt":"Rate overall customer sentiment (Positive/Neutral/Negative) with evidence"},{"field":"danger_signals","prompt":"List any churn risk signals detected"},{"field":"positive_signals","prompt":"List any positive engagement signals"},{"field":"unresolved_issues","prompt":"What issues or complaints remain unresolved?"},{"field":"usage_indicators","prompt":"What did they say about their usage of the product?"},{"field":"expansion_opportunities","prompt":"Any expansion or upsell opportunities mentioned?"},{"field":"competitor_threats","prompt":"Any competitor mentions or evaluation hints?"}]'::jsonb,
  '{"format":"markdown","sections":["## Customer Health Score: {{score}}/10","### Risk Level: {{risk_level}}","### Danger Signals 🚨","{{danger_signals}}","### Positive Signals ✅","{{positive_signals}}","### Unresolved Issues","{{unresolved_issues}}","### Usage Indicators","{{usage_indicators}}","### Expansion Opportunities","{{expansion_opportunities}}","### Recommended Actions","{{recommended_actions}}"]}'::jsonb,
  E'You are a customer success analyst detecting churn risk signals. Analyze the conversation for both danger signals and positive indicators.\n\nRisk Level Definitions:\n- Critical (0-3): Immediate intervention needed\n- At Risk (4-5): Proactive outreach required\n- Healthy (6-7): Monitor and nurture\n- Champion (8-10): Expansion and referral candidate\n\nBe specific about signals detected. Output valid JSON.',
  null
),

-- 8. qbr-analyzer
(
  'qbr-analyzer',
  'QBR Analyzer',
  'customer_success',
  '📊',
  'Analyze Quarterly Business Reviews for account health and expansion',
  '{"title_keywords":["qbr","quarterly","business review","account review","executive briefing"],"external_required":true,"content_signals":["last quarter","metrics","roadmap","roi","value","renewal"]}'::jsonb,
  null,
  '[{"field":"account_overview","prompt":"Brief overview of the account status"},{"field":"value_delivered","prompt":"What value/ROI was demonstrated?"},{"field":"usage_metrics","prompt":"What usage or adoption metrics were discussed?"},{"field":"customer_feedback","prompt":"What feedback did the customer provide?"},{"field":"success_stories","prompt":"Any wins or success stories shared?"},{"field":"challenges_raised","prompt":"What challenges or concerns were raised?"},{"field":"roadmap_items","prompt":"What product roadmap items were discussed?"},{"field":"expansion_opportunities","prompt":"Any expansion or upsell opportunities?"},{"field":"renewal_status","prompt":"What''s the renewal timeline and sentiment?"},{"field":"action_items","prompt":"What commitments were made?"}]'::jsonb,
  '{"format":"markdown","sections":["## QBR Summary: {{account_name}}","**Date:** {{date}}","**Attendees:** {{attendees}}","### Account Health: {{health_score}}","### Value Delivered","{{value_delivered}}","### Usage & Adoption","{{usage_metrics}}","### Customer Feedback","{{customer_feedback}}","### Success Stories","{{success_stories}}","### Challenges","{{challenges_raised}}","### Roadmap Discussion","{{roadmap_items}}","### Expansion Opportunities","{{expansion_opportunities}}","### Renewal Status","{{renewal_status}}","### Action Items","{{action_items}}"]}'::jsonb,
  E'You are a customer success analyst reviewing a QBR. Extract insights about account health, value delivered, and growth opportunities.\n\nPay attention to:\n1. Customer satisfaction signals\n2. Adoption and usage patterns\n3. Expansion opportunities\n4. Renewal risk factors\n\nBe thorough and strategic. Output valid JSON.',
  null
),

-- 9. onboarding-review
(
  'onboarding-review',
  'Onboarding Review',
  'customer_success',
  '🚀',
  'Track customer onboarding progress and time-to-value',
  '{"title_keywords":["onboarding","kickoff","implementation","setup","getting started","training"],"external_required":true,"content_signals":["getting started","setup","training","go live","launch"]}'::jsonb,
  null,
  '[{"field":"onboarding_stage","prompt":"What stage of onboarding is the customer in?"},{"field":"progress_made","prompt":"What progress was made in this session?"},{"field":"blockers","prompt":"What blockers or obstacles are slowing onboarding?"},{"field":"training_needs","prompt":"What additional training does the customer need?"},{"field":"go_live_timeline","prompt":"What''s the target go-live date?"},{"field":"stakeholder_engagement","prompt":"How engaged are the key stakeholders?"},{"field":"quick_wins","prompt":"What quick wins have been achieved?"},{"field":"at_risk_items","prompt":"What items are at risk of delaying go-live?"},{"field":"next_steps","prompt":"What are the next steps?"}]'::jsonb,
  '{"format":"markdown","sections":["## Onboarding Review: {{customer_name}}","**Date:** {{date}}","**Stage:** {{onboarding_stage}}","### Progress Made","{{progress_made}}","### Quick Wins","{{quick_wins}}","### Blockers","{{blockers}}","### Training Needs","{{training_needs}}","### Go-Live Timeline","{{go_live_timeline}}","### At-Risk Items","{{at_risk_items}}","### Stakeholder Engagement","{{stakeholder_engagement}}","### Next Steps","{{next_steps}}"]}'::jsonb,
  E'You are a customer success analyst tracking onboarding progress. Focus on:\n\n1. Time-to-value metrics\n2. Blockers preventing progress\n3. Stakeholder engagement levels\n4. Risk of delayed go-live\n\nIdentify actions to accelerate time-to-value. Output valid JSON.',
  null
),

-- 10. interview-scorecard
(
  'interview-scorecard',
  'Interview Scorecard',
  'recruiting',
  '📋',
  'Evaluate candidate interviews with structured scoring',
  '{"title_keywords":["interview","screen","candidate","hiring","round 1","round 2","final round"],"external_required":true,"content_signals":["tell me about yourself","experience","resume","salary","notice period"]}'::jsonb,
  '{"enabled":true,"max_score":10,"criteria":[{"id":"technical_skills","name":"Technical Skills","weight":2,"question":"Does candidate have required technical skills?"},{"id":"experience","name":"Relevant Experience","weight":2,"question":"Is their experience relevant to the role?"},{"id":"communication","name":"Communication","weight":1,"question":"How well do they communicate complex ideas?"},{"id":"problem_solving","name":"Problem Solving","weight":2,"question":"Did they demonstrate strong problem-solving?"},{"id":"culture_fit","name":"Culture Fit","weight":1,"question":"Do they align with company values and culture?"},{"id":"motivation","name":"Motivation","weight":1,"question":"Are they genuinely interested and motivated?"},{"id":"red_flags","name":"Red Flags","weight":1,"question":"Were there any concerning patterns or inconsistencies?"}]}'::jsonb,
  '[{"field":"candidate_summary","prompt":"Brief summary of the candidate''s background"},{"field":"technical_assessment","prompt":"Assess their technical skills and knowledge"},{"field":"experience_relevance","prompt":"How relevant is their experience to this role?"},{"field":"strengths","prompt":"What are their key strengths?"},{"field":"concerns","prompt":"What concerns or gaps were identified?"},{"field":"questions_asked","prompt":"What questions did the candidate ask? What does this reveal?"},{"field":"logistics","prompt":"Notice period, salary expectations, start date availability"},{"field":"recommendation","prompt":"Hire / Maybe / Pass with reasoning"}]'::jsonb,
  '{"format":"markdown","sections":["## Interview Scorecard: {{candidate_name}}","**Role:** {{role}}","**Interview Date:** {{date}}","**Interviewer:** {{interviewer}}","### Overall Score: {{score}}/10","### Recommendation: {{recommendation}}","### Scoring Breakdown","| Criteria | Score | Notes |","|----------|-------|-------|","{{criteria_table}}","### Candidate Summary","{{candidate_summary}}","### Technical Assessment","{{technical_assessment}}","### Strengths","{{strengths}}","### Concerns","{{concerns}}","### Candidate Questions","{{questions_asked}}","### Logistics","{{logistics}}"]}'::jsonb,
  E'You are an HR analyst creating a structured interview scorecard. Evaluate the candidate objectively based on what was discussed.\n\nUse the STAR method (Situation, Task, Action, Result) to assess behavioral answers. Flag any inconsistencies or concerns.\n\nBe fair and evidence-based. Output valid JSON.',
  null
),

-- 11. customer-interview
(
  'customer-interview',
  'Customer Interview Analyzer',
  'product',
  '🎤',
  'Extract insights from customer research interviews',
  '{"title_keywords":["research","interview","feedback","user interview","customer call"],"external_required":true,"content_signals":["tell me about","how do you","what do you think","walk me through"]}'::jsonb,
  null,
  '[{"field":"interviewee_profile","prompt":"Who is this person? Role, company, industry, experience level"},{"field":"current_workflow","prompt":"How do they currently handle this task/problem?"},{"field":"pain_points","prompt":"List all pain points with severity (high/medium/low) and emotional weight"},{"field":"goals","prompt":"What are they trying to achieve? What does success look like?"},{"field":"feature_requests","prompt":"What features or capabilities did they ask for or wish existed?"},{"field":"workarounds","prompt":"What workarounds or hacks are they using?"},{"field":"quotes","prompt":"Extract 3-5 powerful verbatim quotes that capture their experience"},{"field":"competitive_insights","prompt":"What did they say about alternatives or competitors?"}]'::jsonb,
  '{"format":"markdown","sections":["## Customer Interview: {{interviewee_name}}","### Profile","{{interviewee_profile}}","### Current Workflow","{{current_workflow}}","### Pain Points","| Pain Point | Severity | Emotional Weight | Quote |","|------------|----------|------------------|-------|","{{pain_points_table}}","### Goals & Success Metrics","{{goals}}","### Feature Requests","{{feature_requests}}","### Workarounds (Innovation Opportunities)","{{workarounds}}","### Key Quotes","{{quotes}}","### Competitive Insights","{{competitive_insights}}","### Recommended Actions","{{recommendations}}"]}'::jsonb,
  E'You are a customer research analyst extracting insights from a research interview. Focus on:\n\n1. Understanding the user''s world and context\n2. Identifying pain points with emotional resonance\n3. Extracting verbatim quotes that bring insights to life\n4. Identifying feature opportunities and workarounds\n\nBe empathetic and capture the human element. Output valid JSON.',
  null
),

-- 12. user-research
(
  'user-research',
  'User Research Recorder',
  'product',
  '🔬',
  'Extract product insights from user research sessions',
  '{"title_keywords":["user research","usability","ux research","user test","prototype feedback"],"external_required":true,"content_signals":["how would you","show me how","what do you expect","task"]}'::jsonb,
  null,
  '[{"field":"participant_profile","prompt":"Who is the research participant? Role, experience, context"},{"field":"tasks_performed","prompt":"What tasks or scenarios were tested?"},{"field":"usability_issues","prompt":"What usability issues were observed?"},{"field":"successful_paths","prompt":"Where did users succeed easily?"},{"field":"confusion_points","prompt":"Where did users get confused or stuck?"},{"field":"feature_feedback","prompt":"What feedback was given on specific features?"},{"field":"quotes","prompt":"Key verbatim quotes from the session"},{"field":"recommendations","prompt":"UX recommendations based on observations"}]'::jsonb,
  '{"format":"markdown","sections":["## User Research: {{session_name}}","**Date:** {{date}}","**Participant:** {{participant_profile}}","### Tasks Tested","{{tasks_performed}}","### Usability Issues","| Issue | Severity | Task | Recommendation |","|-------|----------|------|----------------|","{{usability_table}}","### Successful Paths","{{successful_paths}}","### Confusion Points","{{confusion_points}}","### Feature Feedback","{{feature_feedback}}","### Key Quotes","{{quotes}}","### Recommendations","{{recommendations}}"]}'::jsonb,
  E'You are a UX researcher documenting a user research session. Focus on:\n\n1. Observable behaviors vs stated preferences\n2. Usability issues with severity ratings\n3. Mental model mismatches\n4. Verbatim quotes that capture insights\n\nBe objective and observational. Output valid JSON.',
  null
),

-- 13. sprint-retro
(
  'sprint-retro',
  'Sprint Retrospective',
  'engineering',
  '🔄',
  'Structured notes for sprint retrospectives',
  '{"title_keywords":["retro","retrospective","sprint review","post-mortem","lessons learned"],"external_required":false,"content_signals":["what went well","what didn''t","improve","start","stop","continue"]}'::jsonb,
  null,
  '[{"field":"what_went_well","prompt":"What went well during this sprint?"},{"field":"what_didnt_go_well","prompt":"What didn''t go well or could have been better?"},{"field":"action_items","prompt":"What action items were agreed upon for improvement?"},{"field":"team_morale","prompt":"What''s the overall team morale and energy?"},{"field":"blockers_discussed","prompt":"What blockers were discussed?"},{"field":"process_improvements","prompt":"What process improvements were suggested?"},{"field":"shoutouts","prompt":"Were there any shoutouts or kudos given?"}]'::jsonb,
  '{"format":"markdown","sections":["## Sprint Retro: {{sprint_name}}","**Date:** {{date}}","### What Went Well ✅","{{what_went_well}}","### What Didn''t Go Well ❌","{{what_didnt_go_well}}","### Action Items","| Action | Owner | Due Date |","|--------|-------|----------|","{{action_items_table}}","### Process Improvements","{{process_improvements}}","### Team Morale","{{team_morale}}","### Shoutouts 🎉","{{shoutouts}}"]}'::jsonb,
  E'You are an agile coach documenting a sprint retrospective. Focus on:\n\n1. Balanced feedback (wins and areas for improvement)\n2. Actionable improvement items with owners\n3. Team morale and psychological safety\n4. Patterns across retros (if context available)\n\nBe constructive and forward-looking. Output valid JSON.',
  null
),

-- 14. team-sync
(
  'team-sync',
  'Team Sync Notes',
  'internal',
  '👥',
  'Structured notes for team meetings and standups',
  '{"title_keywords":["standup","sync","team meeting","weekly","daily","all hands"],"external_required":false,"content_signals":["update","working on","blocker","this week","next steps"]}'::jsonb,
  null,
  '[{"field":"attendees","prompt":"Who participated in the meeting?"},{"field":"updates_by_person","prompt":"Summarize each person''s update/progress"},{"field":"decisions_made","prompt":"List all decisions made with context"},{"field":"action_items","prompt":"List all action items with owner and due date"},{"field":"blockers","prompt":"What blockers or obstacles were raised?"},{"field":"key_discussions","prompt":"Summarize key discussion topics and outcomes"}]'::jsonb,
  '{"format":"markdown","sections":["## Team Sync: {{date}}","### Attendees","{{attendees}}","### Updates","{{updates_by_person}}","### Decisions","{{decisions_made}}","### Action Items","| Action | Owner | Due Date |","|--------|-------|----------|","{{action_items_table}}","### Blockers","{{blockers}}","### Discussion Notes","{{key_discussions}}"]}'::jsonb,
  E'You are a meeting analyst creating structured notes from an internal team sync. Focus on:\n\n1. Clear attribution of updates to specific people\n2. Explicit decisions with context\n3. Action items with clear owners and timelines\n4. Blockers that need escalation or resolution\n\nBe concise and actionable. Output valid JSON.',
  null
),

-- 15. one-on-one
(
  'one-on-one',
  '1:1 Meeting Notes',
  'internal',
  '🤝',
  'Structured notes for manager-report 1:1 meetings',
  '{"title_keywords":["1:1","1-1","one on one","check-in","catch up"],"external_required":false,"participant_count_max":3}'::jsonb,
  null,
  '[{"field":"topics_discussed","prompt":"What topics were covered?"},{"field":"wins_progress","prompt":"What wins or progress was shared?"},{"field":"challenges","prompt":"What challenges or concerns were raised?"},{"field":"feedback_given","prompt":"What feedback was given (in either direction)?"},{"field":"career_development","prompt":"Any career development or growth discussions?"},{"field":"action_items","prompt":"What action items were agreed upon?"},{"field":"mood_energy","prompt":"What was the overall mood/energy level?"}]'::jsonb,
  '{"format":"markdown","sections":["## 1:1 Notes: {{participants}}","### Topics Covered","{{topics_discussed}}","### Wins & Progress","{{wins_progress}}","### Challenges & Concerns","{{challenges}}","### Feedback","{{feedback_given}}","### Career & Development","{{career_development}}","### Action Items","{{action_items}}","### Mood Check","{{mood_energy}}"]}'::jsonb,
  E'You are a meeting analyst creating notes from a 1:1 meeting. Focus on:\n\n1. Topics that matter to the individual\n2. Wins to celebrate\n3. Challenges that need support\n4. Career development conversations\n5. Clear action items\n\nBe supportive and capture the human element. Output valid JSON.',
  null
),

-- 16. general-notes
(
  'general-notes',
  'General Meeting Notes',
  'general',
  '📝',
  'Generic meeting notes for any meeting type',
  '{"fallback":true}'::jsonb,
  null,
  '[{"field":"summary","prompt":"Provide a concise executive summary (2-3 sentences)"},{"field":"key_points","prompt":"List the main points discussed"},{"field":"decisions","prompt":"List any decisions made"},{"field":"action_items","prompt":"List all action items with owner if mentioned"},{"field":"next_steps","prompt":"What are the agreed next steps?"},{"field":"open_questions","prompt":"What questions remain unanswered?"}]'::jsonb,
  '{"format":"markdown","sections":["## Meeting Notes: {{title}}","**Date:** {{date}}","**Participants:** {{participants}}","### Summary","{{summary}}","### Key Points","{{key_points}}","### Decisions","{{decisions}}","### Action Items","{{action_items}}","### Next Steps","{{next_steps}}","### Open Questions","{{open_questions}}"]}'::jsonb,
  E'You are a professional meeting analyst. Create clear, structured notes from this meeting.\n\nFocus on:\n1. Concise summary\n2. Key points and decisions\n3. Clear action items with owners\n4. Next steps\n\nBe professional and actionable. Output valid JSON.',
  null
)

on conflict (id) do update set
  name = excluded.name,
  category = excluded.category,
  icon = excluded.icon,
  description = excluded.description,
  auto_detect = excluded.auto_detect,
  scoring = excluded.scoring,
  extraction_targets = excluded.extraction_targets,
  output_schema = excluded.output_schema,
  system_prompt = excluded.system_prompt,
  extra = excluded.extra,
  is_active = true;
