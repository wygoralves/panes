use std::collections::{HashMap, HashSet};

use serde_json::Value;
use uuid::Uuid;

use super::{
    ActionResult, ActionType, ApprovalRequestRoute, DiffScope, EngineEvent, OutputStream,
    TokenUsage, TurnCompletionStatus, UsageLimitsSnapshot,
};

pub const APPROVAL_DETAIL_SERVER_METHOD_KEY: &str = "_serverMethod";
pub const APPROVAL_DETAIL_RAW_REQUEST_ID_KEY: &str = "_rawRequestId";

#[derive(Default)]
pub struct TurnEventMapper {
    engine_action_to_internal: HashMap<String, String>,
    pending_actions_without_engine_id: Vec<String>,
    pending_mcp_progress_by_engine_id: HashMap<String, String>,
    reasoning_summary_parts_by_item_id: HashMap<String, i64>,
    latest_token_usage: Option<TokenUsage>,
    latest_usage_limits: UsageLimitsSnapshot,
    streamed_agent_message_items: HashSet<String>,
}

pub struct ApprovalRequest {
    pub approval_id: String,
    pub server_method: String,
    pub event: EngineEvent,
}

impl TurnEventMapper {
    pub fn map_notification(&mut self, method: &str, params: &Value) -> Vec<EngineEvent> {
        let method_key = method_signature(method);

        match method_key.as_str() {
            "turnstarted" => vec![EngineEvent::TurnStarted {
                client_turn_id: None,
            }],
            "turncompleted" => {
                let mut events = Vec::new();
                let token_usage =
                    extract_token_usage(params).or_else(|| self.latest_token_usage.clone());
                let status = extract_turn_completion_status(params);
                if let Some(context_update) = extract_context_usage_limits(params) {
                    self.latest_usage_limits.current_tokens = context_update.current_tokens;
                    self.latest_usage_limits.max_context_tokens = context_update.max_context_tokens;
                    self.latest_usage_limits.context_window_percent =
                        context_update.context_window_percent;
                    events.push(EngineEvent::UsageLimitsUpdated {
                        usage: self.latest_usage_limits.clone(),
                    });
                }

                if status == TurnCompletionStatus::Failed {
                    let message = extract_nested_string(params, &["turn", "error", "message"])
                        .or_else(|| extract_nested_string(params, &["error", "message"]))
                        .unwrap_or_else(|| "Codex turn failed".to_string());

                    events.push(EngineEvent::Error {
                        message,
                        recoverable: false,
                    });
                }

                events.push(EngineEvent::TurnCompleted {
                    token_usage,
                    status,
                });
                self.latest_token_usage = None;
                self.reasoning_summary_parts_by_item_id.clear();
                events
            }
            "turndiffupdated" => {
                let diff = extract_any_string(params, &["diff"]).unwrap_or_default();
                vec![EngineEvent::DiffUpdated {
                    diff,
                    scope: DiffScope::Turn,
                }]
            }
            "turnplanupdated" => {
                let content = render_plan_update(params);
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content }]
                }
            }
            "itemagentmessagedelta" => {
                if let Some(item_id) = extract_any_string(params, &["itemId", "item_id", "id"]) {
                    self.streamed_agent_message_items.insert(item_id);
                }
                let content =
                    extract_any_string(params, &["delta", "text", "content"]).unwrap_or_default();
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::TextDelta { content }]
                }
            }
            "itemplandelta" => {
                let content =
                    extract_any_string(params, &["delta", "text", "content"]).unwrap_or_default();
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content }]
                }
            }
            "itemreasoningsummarypartadded" | "reasoningsummarypartadded" => {
                self.map_reasoning_summary_part_added(params)
            }
            "itemreasoningsummarytextdelta" | "itemreasoningtextdelta" => {
                let content =
                    extract_any_string(params, &["delta", "text", "content"]).unwrap_or_default();
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content }]
                }
            }
            "itemmcptoolcallprogress" => self.map_mcp_tool_call_progress(params),
            "threadtokenusageupdated" => {
                self.latest_token_usage = extract_token_usage(params);
                if let Some(context_update) = extract_context_usage_limits(params) {
                    self.latest_usage_limits.current_tokens = context_update.current_tokens;
                    self.latest_usage_limits.max_context_tokens = context_update.max_context_tokens;
                    self.latest_usage_limits.context_window_percent =
                        context_update.context_window_percent;
                    vec![EngineEvent::UsageLimitsUpdated {
                        usage: self.latest_usage_limits.clone(),
                    }]
                } else {
                    Vec::new()
                }
            }
            "modelrerouted" => self.map_model_rerouted(params),
            "accountratelimitsupdated" => {
                if merge_rate_limits_snapshot(&mut self.latest_usage_limits, params) {
                    vec![EngineEvent::UsageLimitsUpdated {
                        usage: self.latest_usage_limits.clone(),
                    }]
                } else {
                    Vec::new()
                }
            }
            "threadcompacted" | "contextcompacted" => vec![EngineEvent::Notice {
                kind: "context_compacted".to_string(),
                level: "info".to_string(),
                title: "Context compacted".to_string(),
                message:
                    "Codex compacted the active thread context to keep the conversation moving."
                        .to_string(),
            }],
            "deprecationnotice" => map_deprecation_notice(params).into_iter().collect(),
            "hookstarted" | "hookcompleted" => map_hook_notification(method_key.as_str(), params)
                .into_iter()
                .collect(),
            "itemstarted" => self.map_item_started(params),
            "itemcompleted" => self.map_item_completed(params),
            "itemcommandexecutionoutputdelta" | "itemfilechangeoutputdelta" => {
                self.map_output_delta(params).into_iter().collect()
            }
            "itemcommandexecutionterminalinteraction" | "terminalinteraction" => {
                self.map_terminal_interaction(params).into_iter().collect()
            }
            "error" => {
                let message = extract_nested_string(params, &["error", "message"])
                    .or_else(|| extract_any_string(params, &["message"]))
                    .unwrap_or_else(|| "Codex reported an error".to_string());
                let recoverable = params
                    .get("willRetry")
                    .and_then(Value::as_bool)
                    .unwrap_or(false);
                vec![EngineEvent::Error {
                    message,
                    recoverable,
                }]
            }
            _ => Vec::new(),
        }
    }

    pub fn map_rate_limits_snapshot(&mut self, payload: &Value) -> Option<EngineEvent> {
        if merge_rate_limits_snapshot(&mut self.latest_usage_limits, payload) {
            Some(EngineEvent::UsageLimitsUpdated {
                usage: self.latest_usage_limits.clone(),
            })
        } else {
            None
        }
    }

    pub fn map_turn_result(&mut self, result: &Value) -> Vec<EngineEvent> {
        let mut out = Vec::new();

        if let Some(events) = result.get("events").and_then(Value::as_array) {
            for event in events {
                let method = extract_any_string(event, &["method", "event", "type", "name"])
                    .unwrap_or_else(|| "turn/event".to_string());
                let params = event.get("params").unwrap_or(event);
                out.extend(self.map_notification(&method, params));
            }
        }

        if out.is_empty() {
            if let Some(turn) = result.get("turn") {
                if let Some(status) = turn.get("status").and_then(Value::as_str) {
                    let normalized_status = status.to_lowercase();
                    if normalized_status == "inprogress" {
                        out.push(EngineEvent::TurnStarted {
                            client_turn_id: None,
                        });
                    } else {
                        let completion_status = parse_turn_completion_status(status);
                        if completion_status == TurnCompletionStatus::Failed {
                            let message = extract_nested_string(turn, &["error", "message"])
                                .or_else(|| extract_nested_string(result, &["error", "message"]))
                                .unwrap_or_else(|| "Codex turn failed".to_string());
                            out.push(EngineEvent::Error {
                                message,
                                recoverable: false,
                            });
                        }
                        let token_usage =
                            extract_token_usage(result).or_else(|| self.latest_token_usage.clone());
                        out.push(EngineEvent::TurnCompleted {
                            token_usage,
                            status: completion_status,
                        });
                        self.latest_token_usage = None;
                    }
                }
            }
        }

        if let Some(context_update) = extract_context_usage_limits(result) {
            self.latest_usage_limits.current_tokens = context_update.current_tokens;
            self.latest_usage_limits.max_context_tokens = context_update.max_context_tokens;
            self.latest_usage_limits.context_window_percent = context_update.context_window_percent;
            out.push(EngineEvent::UsageLimitsUpdated {
                usage: self.latest_usage_limits.clone(),
            });
        }

        if merge_rate_limits_snapshot(&mut self.latest_usage_limits, result) {
            out.push(EngineEvent::UsageLimitsUpdated {
                usage: self.latest_usage_limits.clone(),
            });
        }

        out
    }

    pub fn map_server_request(
        &mut self,
        request_id: &str,
        raw_request_id: &Value,
        method: &str,
        params: &Value,
    ) -> Option<ApprovalRequest> {
        let normalized = normalize_method(method);
        let method_key = method_signature(method);

        let (action_type, summary) = match method_key.as_str() {
            "itemcommandexecutionrequestapproval" => (
                ActionType::Command,
                extract_any_string(params, &["reason", "command"])
                    .unwrap_or_else(|| "Approval required to run command".to_string()),
            ),
            "itemfilechangerequestapproval" => (
                ActionType::FileEdit,
                extract_any_string(params, &["reason"])
                    .unwrap_or_else(|| "Approval required to apply file changes".to_string()),
            ),
            "execcommandapproval" => (
                ActionType::Command,
                extract_any_string(params, &["command"])
                    .unwrap_or_else(|| "Approval required to run command".to_string()),
            ),
            "applypatchapproval" => (
                ActionType::FileEdit,
                extract_any_string(params, &["reason"])
                    .unwrap_or_else(|| "Approval required to apply patch".to_string()),
            ),
            "itemtoolrequestuserinput" | "toolrequestuserinput" => (
                ActionType::Other,
                extract_first_question_text(params)
                    .unwrap_or_else(|| "Codex requested user input".to_string()),
            ),
            "mcpserverelicitationrequest" => {
                (ActionType::Other, summarize_mcp_elicitation_request(params))
            }
            "itempermissionsrequestapproval" => {
                (ActionType::Other, summarize_permissions_request(params))
            }
            "itemtoolcall" => (
                ActionType::Other,
                extract_any_string(params, &["tool", "name"])
                    .map(|tool| format!("Codex requested dynamic tool call: {tool}"))
                    .unwrap_or_else(|| "Codex requested dynamic tool call".to_string()),
            ),
            _ => return None,
        };

        let approval_id = extract_any_string(params, &["approvalId", "itemId", "callId", "id"])
            .unwrap_or_else(|| request_id.to_string());

        let mut details = params.clone();
        if let Some(object) = details.as_object_mut() {
            object.insert(
                APPROVAL_DETAIL_SERVER_METHOD_KEY.to_string(),
                Value::String(method.to_string()),
            );
            object.insert(
                APPROVAL_DETAIL_RAW_REQUEST_ID_KEY.to_string(),
                raw_request_id.clone(),
            );
        }

        Some(ApprovalRequest {
            approval_id: approval_id.clone(),
            server_method: normalized,
            event: EngineEvent::ApprovalRequested {
                approval_id,
                action_type,
                summary,
                details,
            },
        })
    }

    fn map_item_started(&mut self, params: &Value) -> Vec<EngineEvent> {
        let Some(item) = params.get("item") else {
            return Vec::new();
        };

        let item_type =
            extract_any_string(item, &["type"]).unwrap_or_else(|| "unknown".to_string());

        match item_type.as_str() {
            "commandExecution" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());
                let summary = extract_any_string(item, &["command"])
                    .unwrap_or_else(|| "Run command".to_string());

                vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::Command,
                    summary,
                    details: item.clone(),
                }]
            }
            "fileChange" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());
                let summary = extract_first_change_path(item)
                    .map(|path| format!("Apply changes in {path}"))
                    .unwrap_or_else(|| "Apply file changes".to_string());

                vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::FileEdit,
                    summary,
                    details: item.clone(),
                }]
            }
            "webSearch" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());

                vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::Search,
                    summary: "Web search".to_string(),
                    details: item.clone(),
                }]
            }
            "mcpToolCall" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());
                let mut events = vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::Other,
                    summary: extract_any_string(item, &["name", "toolName"])
                        .unwrap_or_else(|| "Tool call".to_string()),
                    details: item.clone(),
                }];

                if let Some(engine_item_id) = extract_any_string(item, &["id"]) {
                    if let Some(progress_message) = self
                        .pending_mcp_progress_by_engine_id
                        .remove(&engine_item_id)
                    {
                        if let Some(EngineEvent::ActionStarted { action_id, .. }) = events.first() {
                            events.push(EngineEvent::ActionProgressUpdated {
                                action_id: action_id.clone(),
                                message: progress_message,
                            });
                        }
                    }
                }

                events
            }
            "collabAgentToolCall" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let action_id = self.resolve_or_register_action(engine_item_id.as_deref());

                vec![EngineEvent::ActionStarted {
                    action_id,
                    engine_action_id: engine_item_id,
                    action_type: ActionType::Other,
                    summary: summarize_collab_agent_tool_call(item),
                    details: item.clone(),
                }]
            }
            "agentMessage" => Vec::new(),
            "plan" => {
                let text = extract_any_string(item, &["text"]).unwrap_or_default();
                if text.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content: text }]
                }
            }
            "reasoning" => {
                let content = join_string_array(item.get("summary").and_then(Value::as_array))
                    .or_else(|| join_string_array(item.get("content").and_then(Value::as_array)))
                    .unwrap_or_default();
                if content.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::ThinkingDelta { content }]
                }
            }
            _ => Vec::new(),
        }
    }

    fn map_item_completed(&mut self, params: &Value) -> Vec<EngineEvent> {
        let Some(item) = params.get("item") else {
            return Vec::new();
        };

        let item_type =
            extract_any_string(item, &["type"]).unwrap_or_else(|| "unknown".to_string());

        match item_type.as_str() {
            "commandExecution"
            | "fileChange"
            | "webSearch"
            | "mcpToolCall"
            | "collabAgentToolCall" => {
                let engine_item_id = extract_any_string(item, &["id"]);
                let Some(action_id) = self.resolve_action_for_completion(engine_item_id.as_deref())
                else {
                    return Vec::new();
                };

                let status = extract_any_string(item, &["status"])
                    .unwrap_or_else(|| "completed".to_string());
                let normalized_status = status.to_lowercase();
                let success = normalized_status == "completed";

                let output = if item_type == "collabAgentToolCall" {
                    collab_agent_completion_output(item)
                } else {
                    extract_any_string(item, &["aggregatedOutput", "output", "text"])
                };
                let mut error = if item_type == "collabAgentToolCall" {
                    collab_agent_error(item, &normalized_status)
                } else {
                    extract_item_error(item)
                };
                if !success && error.is_none() {
                    error = Some(match normalized_status.as_str() {
                        "declined" => "Action was declined by user approval policy".to_string(),
                        "interrupted" => "Action was interrupted".to_string(),
                        other => format!("Action failed with status `{other}`"),
                    });
                }
                if !success {
                    if let Some(raw_error) = item.get("error") {
                        log::warn!(
                            "codex {item_type} completed with status={normalized_status}, raw_error={}",
                            raw_error
                        );
                    } else {
                        log::warn!(
                            "codex {item_type} completed with status={normalized_status} and no error payload"
                        );
                    }
                }
                let duration_ms =
                    extract_any_u64(item, &["durationMs", "duration_ms"]).unwrap_or(0);
                let diff = if item_type == "fileChange" {
                    extract_combined_diff(item)
                } else {
                    None
                };

                vec![EngineEvent::ActionCompleted {
                    action_id,
                    result: ActionResult {
                        success,
                        output,
                        error,
                        diff,
                        duration_ms,
                    },
                }]
            }
            "agentMessage" => {
                if let Some(item_id) = extract_any_string(item, &["id"]) {
                    if self.streamed_agent_message_items.remove(&item_id) {
                        return Vec::new();
                    }
                }
                let text = extract_any_string(item, &["text"]).unwrap_or_default();
                if text.is_empty() {
                    Vec::new()
                } else {
                    vec![EngineEvent::TextDelta { content: text }]
                }
            }
            _ => Vec::new(),
        }
    }

    fn map_output_delta(&mut self, params: &Value) -> Option<EngineEvent> {
        let item_id = extract_any_string(params, &["itemId", "item_id", "id"])?;
        let action_id = self.resolve_action_for_output(Some(&item_id))?;

        let content = extract_any_string(params, &["delta", "output", "text", "content"])?;
        let stream_raw = extract_any_string(params, &["stream", "channel", "target"])
            .unwrap_or_else(|| "stdout".to_string());

        let stream = if stream_raw.to_lowercase().contains("err") {
            OutputStream::Stderr
        } else {
            OutputStream::Stdout
        };

        Some(EngineEvent::ActionOutputDelta {
            action_id,
            stream,
            content,
        })
    }

    fn map_terminal_interaction(&self, params: &Value) -> Option<EngineEvent> {
        let item_id = extract_any_string(params, &["itemId", "item_id", "id"])?;
        let action_id = self.resolve_action_for_output(Some(&item_id))?;
        let content = extract_any_string(params, &["stdin"])?;
        if content.is_empty() {
            return None;
        }

        Some(EngineEvent::ActionOutputDelta {
            action_id,
            stream: OutputStream::Stdin,
            content,
        })
    }

    fn map_mcp_tool_call_progress(&mut self, params: &Value) -> Vec<EngineEvent> {
        let Some(engine_item_id) = extract_any_string(params, &["itemId", "item_id", "id"]) else {
            return Vec::new();
        };
        let message =
            extract_any_string(params, &["message", "text", "content"]).unwrap_or_default();
        if message.is_empty() {
            return Vec::new();
        }

        if let Some(action_id) = self.engine_action_to_internal.get(&engine_item_id).cloned() {
            return vec![EngineEvent::ActionProgressUpdated { action_id, message }];
        }

        self.pending_mcp_progress_by_engine_id
            .insert(engine_item_id, message);
        Vec::new()
    }

    fn map_model_rerouted(&mut self, params: &Value) -> Vec<EngineEvent> {
        let Some(from_model) = extract_any_string(params, &["fromModel", "from_model"]) else {
            return Vec::new();
        };
        let Some(to_model) = extract_any_string(params, &["toModel", "to_model"]) else {
            return Vec::new();
        };
        let Some(reason) = extract_any_string(params, &["reason"]) else {
            return Vec::new();
        };

        vec![EngineEvent::ModelRerouted {
            from_model,
            to_model,
            reason,
        }]
    }

    fn map_reasoning_summary_part_added(&mut self, params: &Value) -> Vec<EngineEvent> {
        let Some(item_id) = extract_any_string(params, &["itemId", "item_id"]) else {
            return Vec::new();
        };
        let summary_index =
            extract_any_i64(params, &["summaryIndex", "summary_index"]).unwrap_or_default();
        let previous = self
            .reasoning_summary_parts_by_item_id
            .insert(item_id, summary_index);

        if summary_index <= 0 || previous.is_none() || previous >= Some(summary_index) {
            Vec::new()
        } else {
            vec![EngineEvent::ThinkingDelta {
                content: "\n".to_string(),
            }]
        }
    }

    fn resolve_or_register_action(&mut self, engine_action_id: Option<&str>) -> String {
        if let Some(engine_action_id) = engine_action_id {
            if let Some(existing) = self.engine_action_to_internal.get(engine_action_id) {
                return existing.clone();
            }
        }

        let action_id = format!("action-{}", Uuid::new_v4());
        if let Some(engine_action_id) = engine_action_id {
            self.engine_action_to_internal
                .insert(engine_action_id.to_string(), action_id.clone());
        } else {
            self.pending_actions_without_engine_id
                .push(action_id.clone());
        }
        action_id
    }

    fn resolve_action_for_output(&self, engine_action_id: Option<&str>) -> Option<String> {
        if let Some(value) = engine_action_id {
            return self.engine_action_to_internal.get(value).cloned();
        }

        self.pending_actions_without_engine_id.first().cloned()
    }

    fn resolve_action_for_completion(&mut self, engine_action_id: Option<&str>) -> Option<String> {
        if let Some(value) = engine_action_id {
            if let Some(existing) = self.engine_action_to_internal.get(value).cloned() {
                return Some(existing);
            }

            let synthetic = format!("action-{}", Uuid::new_v4());
            self.engine_action_to_internal
                .insert(value.to_string(), synthetic.clone());
            return Some(synthetic);
        }

        if self.pending_actions_without_engine_id.is_empty() {
            None
        } else {
            Some(self.pending_actions_without_engine_id.remove(0))
        }
    }
}

pub fn extract_persisted_approval_route(details: &Value) -> Option<ApprovalRequestRoute> {
    let object = details.as_object()?;
    let server_method = object
        .get(APPROVAL_DETAIL_SERVER_METHOD_KEY)
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())?;
    let raw_request_id = object.get(APPROVAL_DETAIL_RAW_REQUEST_ID_KEY)?.clone();

    Some(ApprovalRequestRoute {
        server_method: server_method.to_string(),
        raw_request_id,
    })
}

fn extract_item_error(item: &Value) -> Option<String> {
    if let Some(message) = extract_nested_string(item, &["error", "message"])
        .or_else(|| extract_nested_string(item, &["error", "reason"]))
        .or_else(|| extract_nested_string(item, &["error", "details"]))
        .or_else(|| extract_nested_string(item, &["error", "stderr"]))
        .or_else(|| extract_nested_string(item, &["error", "stdout"]))
    {
        return Some(message);
    }

    if let Some(error_value) = item.get("error") {
        if let Some(message) = error_value.as_str() {
            return Some(message.to_string());
        }

        if !error_value.is_null() {
            return Some(error_value.to_string());
        }
    }

    None
}

fn extract_turn_completion_status(params: &Value) -> TurnCompletionStatus {
    let status = params
        .get("turn")
        .and_then(|turn| turn.get("status"))
        .and_then(Value::as_str)
        .unwrap_or("completed");
    parse_turn_completion_status(status)
}

fn render_plan_update(params: &Value) -> String {
    let mut lines = Vec::new();
    if let Some(explanation) = extract_any_string(params, &["explanation"]) {
        if !explanation.is_empty() {
            lines.push(explanation);
        }
    }

    if let Some(plan) = params.get("plan").and_then(Value::as_array) {
        for entry in plan {
            let Some(step) = extract_any_string(entry, &["step"]) else {
                continue;
            };
            let status =
                extract_any_string(entry, &["status"]).unwrap_or_else(|| "pending".to_string());
            lines.push(format!("- [{status}] {step}"));
        }
    }

    lines.join("\n")
}

fn parse_turn_completion_status(status: &str) -> TurnCompletionStatus {
    if status.eq_ignore_ascii_case("failed") {
        TurnCompletionStatus::Failed
    } else if status.eq_ignore_ascii_case("interrupted") {
        TurnCompletionStatus::Interrupted
    } else {
        TurnCompletionStatus::Completed
    }
}

fn extract_first_question_text(params: &Value) -> Option<String> {
    let questions = params.get("questions")?.as_array()?;
    let first = questions.first()?;
    extract_any_string(first, &["question", "header"])
}

fn map_deprecation_notice(params: &Value) -> Option<EngineEvent> {
    let summary = extract_any_string(params, &["summary"])?;
    let details = extract_any_string(params, &["details"]);
    let message = match details {
        Some(details) if !details.is_empty() => format!("{summary}\n\n{details}"),
        _ => summary,
    };

    Some(EngineEvent::Notice {
        kind: "deprecation_notice".to_string(),
        level: "warning".to_string(),
        title: "Deprecation notice".to_string(),
        message,
    })
}

fn map_hook_notification(method_key: &str, params: &Value) -> Option<EngineEvent> {
    let run = params.get("run")?;
    let hook_id = extract_any_string(run, &["id"]).unwrap_or_else(|| "unknown".to_string());
    let event_name =
        extract_any_string(run, &["eventName", "event_name"]).unwrap_or_else(|| "hook".to_string());
    let handler_type = extract_any_string(run, &["handlerType", "handler_type"])
        .unwrap_or_else(|| "handler".to_string());
    let execution_mode =
        extract_any_string(run, &["executionMode", "execution_mode"]).unwrap_or_default();
    let scope = extract_any_string(run, &["scope"]).unwrap_or_default();
    let source_path = extract_any_string(run, &["sourcePath", "source_path"]).unwrap_or_default();
    let status = extract_any_string(run, &["status"]).unwrap_or_else(|| {
        if method_key == "hookstarted" {
            "running".to_string()
        } else {
            "completed".to_string()
        }
    });

    let mut message_lines = vec![format!(
        "{event_name} hook via {handler_type}{}{}",
        if execution_mode.is_empty() {
            String::new()
        } else {
            format!(" ({execution_mode})")
        },
        if scope.is_empty() {
            String::new()
        } else {
            format!(" [{scope}]")
        }
    )];

    if !source_path.is_empty() {
        message_lines.push(format!("Source: {source_path}"));
    }

    if let Some(status_message) = extract_any_string(run, &["statusMessage", "status_message"]) {
        if !status_message.is_empty() {
            message_lines.push(status_message);
        }
    }

    if let Some(entries_text) = summarize_hook_entries(run.get("entries").and_then(Value::as_array))
    {
        if !entries_text.is_empty() {
            message_lines.push(entries_text);
        }
    }

    let (kind_prefix, title) = if method_key == "hookstarted" {
        ("hook_started", "Hook started")
    } else {
        ("hook_completed", "Hook completed")
    };
    let level = match status.as_str() {
        "failed" => "error",
        "blocked" | "stopped" => "warning",
        _ => "info",
    };

    Some(EngineEvent::Notice {
        kind: format!("{kind_prefix}_{hook_id}"),
        level: level.to_string(),
        title: title.to_string(),
        message: message_lines.join("\n"),
    })
}

fn summarize_permissions_request(params: &Value) -> String {
    if let Some(reason) = extract_any_string(params, &["reason"]) {
        if !reason.is_empty() {
            return reason;
        }
    }

    let mut requested = Vec::new();
    let permissions = params.get("permissions");
    let file_system =
        permissions.and_then(|value| value.get("fileSystem").or_else(|| value.get("file_system")));
    if let Some(file_system) = file_system {
        if has_nonempty_array(file_system.get("write")) {
            requested.push("write access");
        }
        if has_nonempty_array(file_system.get("read")) {
            requested.push("read access");
        }
    }

    let network = permissions
        .and_then(|value| value.get("network"))
        .and_then(|value| value.get("enabled"))
        .and_then(Value::as_bool);
    if network == Some(true) {
        requested.push("network access");
    }

    let macos = permissions.and_then(|value| value.get("macos"));
    if macos.and_then(Value::as_object).is_some() {
        requested.push("macOS permissions");
    }

    if requested.is_empty() {
        "Codex requested additional permissions".to_string()
    } else {
        format!("Codex requested {}", requested.join(", "))
    }
}

fn summarize_mcp_elicitation_request(params: &Value) -> String {
    let server_name = extract_any_string(params, &["serverName", "server_name"])
        .unwrap_or_else(|| "MCP server".to_string());
    let message = extract_any_string(params, &["message"]).unwrap_or_default();

    if message.is_empty() {
        format!("{server_name} requested input")
    } else {
        format!("{server_name} requested input: {message}")
    }
}

fn summarize_hook_entries(entries: Option<&Vec<Value>>) -> Option<String> {
    let entries = entries?;
    let lines = entries
        .iter()
        .filter_map(|entry| {
            let text = extract_any_string(entry, &["text"])?;
            if text.is_empty() {
                return None;
            }
            let kind = extract_any_string(entry, &["kind"]).unwrap_or_default();
            if kind.is_empty() {
                Some(text)
            } else {
                Some(format!("{kind}: {text}"))
            }
        })
        .collect::<Vec<_>>();

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn summarize_collab_agent_tool_call(item: &Value) -> String {
    let tool = extract_any_string(item, &["tool"]).unwrap_or_else(|| "agent_call".to_string());
    format!("Collaborative agent: {tool}")
}

fn collab_agent_completion_output(item: &Value) -> Option<String> {
    let mut lines = Vec::new();

    if let Some(receiver_ids) = item.get("receiverThreadIds").and_then(Value::as_array) {
        let receivers = receiver_ids
            .iter()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>();
        if !receivers.is_empty() {
            lines.push(format!("Receiver threads: {}", receivers.join(", ")));
        }
    }

    if let Some(agents_states) = item.get("agentsStates").and_then(Value::as_object) {
        let states = agents_states
            .iter()
            .filter_map(|(agent_id, state)| {
                let status = extract_any_string(state, &["status"])?;
                let message = extract_any_string(state, &["message"]).unwrap_or_default();
                if message.is_empty() {
                    Some(format!("{agent_id}: {status}"))
                } else {
                    Some(format!("{agent_id}: {status} ({message})"))
                }
            })
            .collect::<Vec<_>>();
        if !states.is_empty() {
            lines.push(format!("Agent states: {}", states.join("; ")));
        }
    }

    if lines.is_empty() {
        None
    } else {
        Some(lines.join("\n"))
    }
}

fn collab_agent_error(item: &Value, normalized_status: &str) -> Option<String> {
    if let Some(agents_states) = item.get("agentsStates").and_then(Value::as_object) {
        for (agent_id, state) in agents_states {
            let status = extract_any_string(state, &["status"]).unwrap_or_default();
            if matches!(status.as_str(), "errored" | "shutdown" | "notFound") {
                let message = extract_any_string(state, &["message"]).unwrap_or_default();
                return Some(if message.is_empty() {
                    format!("Agent {agent_id} ended with status `{status}`")
                } else {
                    format!("Agent {agent_id} ended with status `{status}`: {message}")
                });
            }
        }
    }

    if normalized_status == "failed" {
        extract_any_string(item, &["prompt"])
            .map(|prompt| format!("Collaborative agent failed: {prompt}"))
    } else {
        None
    }
}

fn has_nonempty_array(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_array)
        .map(|items| !items.is_empty())
        .unwrap_or(false)
}

#[derive(Debug, Clone)]
struct RateLimitWindowInfo {
    used_percent: u8,
    resets_at: Option<i64>,
    window_duration_mins: Option<i64>,
}

const CONTEXT_WINDOW_BASELINE_TOKENS: u64 = 12_000;

fn extract_context_tokens(token_usage: &Value) -> Option<u64> {
    token_usage
        .get("last")
        .and_then(|last| {
            extract_any_u64(last, &["totalTokens", "total_tokens"])
                .or_else(|| extract_any_u64(last, &["inputTokens", "input_tokens"]))
        })
        .or_else(|| {
            token_usage.get("total").and_then(|total| {
                extract_any_u64(total, &["totalTokens", "total_tokens"])
                    .or_else(|| extract_any_u64(total, &["inputTokens", "input_tokens"]))
            })
        })
        .or_else(|| extract_any_u64(token_usage, &["totalTokens", "total_tokens"]))
}

fn calculate_context_window_percent_remaining(
    current_tokens: u64,
    max_context_tokens: u64,
) -> Option<u8> {
    if max_context_tokens <= CONTEXT_WINDOW_BASELINE_TOKENS {
        return Some(0);
    }

    let effective_window = max_context_tokens - CONTEXT_WINDOW_BASELINE_TOKENS;
    let used_tokens = current_tokens.saturating_sub(CONTEXT_WINDOW_BASELINE_TOKENS);
    let remaining_tokens = effective_window.saturating_sub(used_tokens);
    let percent = ((remaining_tokens as f64 / effective_window as f64) * 100.0)
        .clamp(0.0, 100.0)
        .round() as i64;

    Some(percent.clamp(0, 100) as u8)
}

fn extract_context_usage_limits(value: &Value) -> Option<UsageLimitsSnapshot> {
    let token_usage = value
        .get("tokenUsage")
        .or_else(|| value.get("turn").and_then(|turn| turn.get("tokenUsage")))?;

    let current_tokens = extract_context_tokens(token_usage);

    let max_context_tokens =
        extract_any_u64(token_usage, &["modelContextWindow", "model_context_window"]);

    let context_window_percent = match (current_tokens, max_context_tokens) {
        (Some(current), Some(limit)) if limit > 0 => {
            calculate_context_window_percent_remaining(current, limit)
        }
        _ => None,
    };

    if current_tokens.is_none() && max_context_tokens.is_none() {
        return None;
    }

    Some(UsageLimitsSnapshot {
        current_tokens,
        max_context_tokens,
        context_window_percent,
        ..UsageLimitsSnapshot::default()
    })
}

fn merge_rate_limits_snapshot(target: &mut UsageLimitsSnapshot, payload: &Value) -> bool {
    let Some(snapshot) = select_rate_limit_snapshot(payload) else {
        return false;
    };

    let windows = [
        parse_rate_limit_window(snapshot.get("primary")),
        parse_rate_limit_window(snapshot.get("secondary")),
    ];

    let five_hour_window = select_rate_limit_window(&windows, 300, true);
    let weekly_window = select_rate_limit_window(&windows, 10_080, false);

    let mut changed = false;

    let five_hour_percent = five_hour_window.as_ref().map(|window| window.used_percent);
    if target.five_hour_percent != five_hour_percent {
        target.five_hour_percent = five_hour_percent;
        changed = true;
    }

    let five_hour_resets_at = five_hour_window
        .as_ref()
        .and_then(|window| window.resets_at);
    if target.five_hour_resets_at != five_hour_resets_at {
        target.five_hour_resets_at = five_hour_resets_at;
        changed = true;
    }

    let weekly_percent = weekly_window.as_ref().map(|window| window.used_percent);
    if target.weekly_percent != weekly_percent {
        target.weekly_percent = weekly_percent;
        changed = true;
    }

    let weekly_resets_at = weekly_window.as_ref().and_then(|window| window.resets_at);
    if target.weekly_resets_at != weekly_resets_at {
        target.weekly_resets_at = weekly_resets_at;
        changed = true;
    }

    changed
}

fn select_rate_limit_snapshot(payload: &Value) -> Option<&Value> {
    if let Some(by_limit_id) = payload
        .get("rateLimitsByLimitId")
        .and_then(Value::as_object)
    {
        if let Some(codex_snapshot) = by_limit_id.get("codex") {
            return Some(codex_snapshot);
        }
        if let Some(first_snapshot) = by_limit_id.values().find(|value| value.is_object()) {
            return Some(first_snapshot);
        }
    }

    if let Some(snapshot) = payload.get("rateLimits") {
        return Some(snapshot);
    }

    if payload.get("primary").is_some() || payload.get("secondary").is_some() {
        return Some(payload);
    }

    None
}

fn parse_rate_limit_window(value: Option<&Value>) -> Option<RateLimitWindowInfo> {
    let value = value?;
    if value.is_null() {
        return None;
    }

    let used_percent = extract_any_u64(value, &["usedPercent", "used_percent"])
        .map(|value| value.min(100) as u8)?;
    let resets_at = extract_any_i64(value, &["resetsAt", "resets_at"]).map(normalize_epoch_millis);
    let window_duration_mins =
        extract_any_i64(value, &["windowDurationMins", "window_duration_mins"]);

    Some(RateLimitWindowInfo {
        used_percent,
        resets_at,
        window_duration_mins,
    })
}

fn select_rate_limit_window(
    windows: &[Option<RateLimitWindowInfo>],
    target_duration_mins: i64,
    prefer_shorter_when_unknown: bool,
) -> Option<RateLimitWindowInfo> {
    let candidates: Vec<RateLimitWindowInfo> = windows.iter().flatten().cloned().collect();
    if candidates.is_empty() {
        return None;
    }

    let with_durations: Vec<RateLimitWindowInfo> = candidates
        .iter()
        .filter(|window| window.window_duration_mins.is_some())
        .cloned()
        .collect();

    if !with_durations.is_empty() {
        return with_durations.into_iter().min_by_key(|window| {
            (window.window_duration_mins.unwrap_or(target_duration_mins) - target_duration_mins)
                .abs()
        });
    }

    if prefer_shorter_when_unknown {
        candidates.into_iter().next()
    } else {
        candidates.into_iter().last()
    }
}

fn normalize_epoch_millis(value: i64) -> i64 {
    if (0..10_000_000_000).contains(&value) {
        value.saturating_mul(1000)
    } else {
        value
    }
}

fn extract_token_usage(value: &Value) -> Option<TokenUsage> {
    let mut candidates: Vec<&Value> = vec![value];

    if let Some(turn) = value.get("turn") {
        candidates.push(turn);
        if let Some(usage) = turn.get("usage") {
            candidates.push(usage);
        }
        if let Some(token_usage) = turn.get("tokenUsage") {
            candidates.push(token_usage);
            if let Some(last) = token_usage.get("last") {
                candidates.push(last);
            }
            if let Some(total) = token_usage.get("total") {
                candidates.push(total);
            }
        }
    }

    if let Some(token_usage) = value.get("tokenUsage") {
        candidates.push(token_usage);
        if let Some(last) = token_usage.get("last") {
            candidates.push(last);
        }
        if let Some(total) = token_usage.get("total") {
            candidates.push(total);
        }
    }

    for usage in candidates {
        let input = usage
            .get("input")
            .and_then(Value::as_u64)
            .or_else(|| usage.get("input_tokens").and_then(Value::as_u64))
            .or_else(|| usage.get("inputTokens").and_then(Value::as_u64))
            .or_else(|| usage.get("prompt_tokens").and_then(Value::as_u64))
            .or_else(|| usage.get("promptTokens").and_then(Value::as_u64));

        let output = usage
            .get("output")
            .and_then(Value::as_u64)
            .or_else(|| usage.get("output_tokens").and_then(Value::as_u64))
            .or_else(|| usage.get("outputTokens").and_then(Value::as_u64))
            .or_else(|| usage.get("completion_tokens").and_then(Value::as_u64))
            .or_else(|| usage.get("completionTokens").and_then(Value::as_u64));

        if let (Some(input), Some(output)) = (input, output) {
            return Some(TokenUsage { input, output });
        }
    }

    None
}

fn extract_combined_diff(item: &Value) -> Option<String> {
    let changes = item.get("changes")?.as_array()?;
    let mut diffs = Vec::new();

    for change in changes {
        if let Some(diff) = extract_any_string(change, &["diff"]) {
            if !diff.is_empty() {
                diffs.push(diff);
            }
        }
    }

    if diffs.is_empty() {
        None
    } else {
        Some(diffs.join("\n\n"))
    }
}

fn extract_first_change_path(item: &Value) -> Option<String> {
    item.get("changes")
        .and_then(Value::as_array)
        .and_then(|changes| changes.first())
        .and_then(|change| extract_any_string(change, &["path"]))
}

fn extract_any_string(value: &Value, keys: &[&str]) -> Option<String> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(string) = found.as_str() {
                return Some(string.to_string());
            }
            if found.is_number() || found.is_boolean() {
                return Some(found.to_string());
            }
        }
    }
    None
}

fn extract_any_u64(value: &Value, keys: &[&str]) -> Option<u64> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(number) = found.as_u64() {
                return Some(number);
            }
            if let Some(number) = found.as_i64() {
                if number >= 0 {
                    return Some(number as u64);
                }
            }
            if let Some(number) = found.as_str().and_then(|value| value.parse::<u64>().ok()) {
                return Some(number);
            }
        }
    }
    None
}

fn extract_any_i64(value: &Value, keys: &[&str]) -> Option<i64> {
    for key in keys {
        if let Some(found) = value.get(*key) {
            if let Some(number) = found.as_i64() {
                return Some(number);
            }
            if let Some(number) = found.as_u64() {
                if number <= i64::MAX as u64 {
                    return Some(number as i64);
                }
            }
            if let Some(number) = found.as_str().and_then(|value| value.parse::<i64>().ok()) {
                return Some(number);
            }
        }
    }
    None
}

fn extract_nested_string(value: &Value, path: &[&str]) -> Option<String> {
    let mut current = value;
    for segment in path {
        current = current.get(*segment)?;
    }
    current.as_str().map(ToOwned::to_owned)
}

fn normalize_method(method: &str) -> String {
    method
        .replace('.', "/")
        .to_lowercase()
        .split('/')
        .filter(|segment| !segment.is_empty())
        .map(|segment| {
            segment
                .chars()
                .filter(|ch| *ch != '_' && *ch != '-')
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("/")
}

fn method_signature(method: &str) -> String {
    normalize_method(method).replace('/', "")
}

fn join_string_array(items: Option<&Vec<Value>>) -> Option<String> {
    let items = items?;
    let values = items
        .iter()
        .filter_map(Value::as_str)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if values.is_empty() {
        None
    } else {
        Some(values.join("\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    #[test]
    fn map_server_request_dynamic_tool_call_uses_call_id() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "callId": "call_abc",
            "tool": "my_tool",
            "arguments": { "query": "docs" }
        });

        let approval = mapper
            .map_server_request("request-1", &json!(42), "item/tool/call", &params)
            .expect("expected approval request");

        assert_eq!(approval.approval_id, "call_abc");
        assert_eq!(approval.server_method, "item/tool/call");

        match approval.event {
            EngineEvent::ApprovalRequested {
                approval_id,
                action_type,
                summary,
                details,
            } => {
                assert_eq!(approval_id, "call_abc");
                assert!(matches!(action_type, ActionType::Other));
                assert_eq!(summary, "Codex requested dynamic tool call: my_tool");
                assert_eq!(
                    details
                        .get(APPROVAL_DETAIL_SERVER_METHOD_KEY)
                        .and_then(Value::as_str),
                    Some("item/tool/call")
                );
                assert_eq!(
                    details.get(APPROVAL_DETAIL_RAW_REQUEST_ID_KEY),
                    Some(&json!(42))
                );
            }
            _ => panic!("expected approval request event"),
        }
    }

    #[test]
    fn map_server_request_supports_tool_request_user_input_alias() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "itemId": "item_42",
            "questions": [
                {
                    "id": "lang",
                    "question": "Qual linguagem usar?",
                    "options": ["TypeScript"]
                }
            ]
        });

        let approval = mapper
            .map_server_request(
                "request-2",
                &json!("req-2"),
                "tool/requestUserInput",
                &params,
            )
            .expect("expected approval request");

        assert_eq!(approval.approval_id, "item_42");
        assert_eq!(approval.server_method, "tool/requestuserinput");

        match approval.event {
            EngineEvent::ApprovalRequested {
                action_type,
                summary,
                ..
            } => {
                assert!(matches!(action_type, ActionType::Other));
                assert_eq!(summary, "Qual linguagem usar?");
            }
            _ => panic!("expected approval request event"),
        }
    }

    #[test]
    fn map_server_request_supports_snake_case_method_names() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "itemId": "item_84",
            "questions": [
                {
                    "id": "lang",
                    "question": "Preferred language?",
                    "options": ["Rust"]
                }
            ]
        });

        let approval = mapper
            .map_server_request(
                "request-3",
                &json!("req-3"),
                "item/tool/request_user_input",
                &params,
            )
            .expect("expected approval request");

        assert_eq!(approval.approval_id, "item_84");
        assert_eq!(approval.server_method, "item/tool/requestuserinput");
    }

    #[test]
    fn map_server_request_permissions_uses_item_id() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "itemId": "perm_42",
            "reason": "Need write access to apply the requested patch",
            "permissions": {
                "fileSystem": {
                    "write": ["/tmp/project"]
                }
            }
        });

        let approval = mapper
            .map_server_request(
                "request-4",
                &json!("req-4"),
                "item/permissions/requestApproval",
                &params,
            )
            .expect("expected approval request");

        assert_eq!(approval.approval_id, "perm_42");
        assert_eq!(approval.server_method, "item/permissions/requestapproval");

        match approval.event {
            EngineEvent::ApprovalRequested {
                action_type,
                summary,
                details,
                ..
            } => {
                assert!(matches!(action_type, ActionType::Other));
                assert_eq!(summary, "Need write access to apply the requested patch");
                assert_eq!(
                    details
                        .get(APPROVAL_DETAIL_SERVER_METHOD_KEY)
                        .and_then(Value::as_str),
                    Some("item/permissions/requestApproval")
                );
                assert_eq!(
                    details.get(APPROVAL_DETAIL_RAW_REQUEST_ID_KEY),
                    Some(&json!("req-4"))
                );
            }
            _ => panic!("expected approval request event"),
        }
    }

    #[test]
    fn map_server_request_mcp_elicitation_uses_request_id_when_no_stable_id_exists() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "serverName": "docs",
            "message": "Choose a scope",
            "mode": "form",
            "requestedSchema": {
                "type": "object",
                "properties": {
                    "scope": {
                        "type": "string"
                    }
                }
            }
        });

        let approval = mapper
            .map_server_request(
                "request-5",
                &json!("req-5"),
                "mcpServer/elicitation/request",
                &params,
            )
            .expect("expected approval request");

        assert_eq!(approval.approval_id, "request-5");
        assert_eq!(approval.server_method, "mcpserver/elicitation/request");

        match approval.event {
            EngineEvent::ApprovalRequested {
                action_type,
                summary,
                ..
            } => {
                assert!(matches!(action_type, ActionType::Other));
                assert_eq!(summary, "docs requested input: Choose a scope");
            }
            _ => panic!("expected approval request event"),
        }
    }

    #[test]
    fn extract_persisted_approval_route_reads_hidden_transport_fields() {
        assert_eq!(
            extract_persisted_approval_route(&json!({
                "_serverMethod": "item/fileChange/requestApproval",
                "_rawRequestId": 42
            })),
            Some(ApprovalRequestRoute {
                server_method: "item/fileChange/requestApproval".to_string(),
                raw_request_id: json!(42),
            })
        );
    }

    #[test]
    fn extract_persisted_approval_route_rejects_legacy_rows_without_raw_request_id() {
        assert_eq!(
            extract_persisted_approval_route(&json!({
                "_serverMethod": "item/fileChange/requestApproval"
            })),
            None
        );
    }

    #[test]
    fn map_notification_supports_snake_case_method_names() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "tokenUsage": {
                "total": {
                    "totalTokens": 50000
                },
                "modelContextWindow": 200000
            }
        });

        let events = mapper.map_notification("thread_token_usage_updated", &params);
        assert_eq!(events.len(), 1);
        match &events[0] {
            EngineEvent::UsageLimitsUpdated { usage } => {
                assert_eq!(usage.current_tokens, Some(50000));
                assert_eq!(usage.max_context_tokens, Some(200000));
                assert_eq!(usage.context_window_percent, Some(80));
            }
            _ => panic!("expected usage limits update"),
        }
    }

    #[test]
    fn map_notification_emits_context_usage_from_thread_token_usage() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "tokenUsage": {
                "last": {
                    "totalTokens": 30000
                },
                "total": {
                    "totalTokens": 90000
                },
                "modelContextWindow": 200000
            }
        });

        let events = mapper.map_notification("thread/tokenUsage/updated", &params);
        assert_eq!(events.len(), 1);

        match &events[0] {
            EngineEvent::UsageLimitsUpdated { usage } => {
                assert_eq!(usage.current_tokens, Some(30000));
                assert_eq!(usage.max_context_tokens, Some(200000));
                assert_eq!(usage.context_window_percent, Some(90));
            }
            _ => panic!("expected usage limits update"),
        }
    }

    #[test]
    fn map_notification_emits_model_rerouted_event() {
        let mut mapper = TurnEventMapper::default();
        let params = json!({
            "threadId": "thr_123",
            "turnId": "turn_123",
            "fromModel": "gpt-5.1-codex-mini",
            "toModel": "gpt-5.3-codex",
            "reason": "highRiskCyberActivity",
            "extra": {
                "ignored": true
            }
        });

        let events = mapper.map_notification("model/rerouted", &params);
        assert_eq!(events.len(), 1);
        match &events[0] {
            EngineEvent::ModelRerouted {
                from_model,
                to_model,
                reason,
            } => {
                assert_eq!(from_model, "gpt-5.1-codex-mini");
                assert_eq!(to_model, "gpt-5.3-codex");
                assert_eq!(reason, "highRiskCyberActivity");
            }
            _ => panic!("expected model rerouted event"),
        }
    }

    #[test]
    fn map_notification_emits_context_compacted_notice() {
        let mut mapper = TurnEventMapper::default();

        let events = mapper.map_notification(
            "thread/compacted",
            &json!({
                "threadId": "thr_123",
                "turnId": "turn_123"
            }),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            EngineEvent::Notice {
                kind,
                level,
                title,
                message,
            } => {
                assert_eq!(kind, "context_compacted");
                assert_eq!(level, "info");
                assert_eq!(title, "Context compacted");
                assert!(message.contains("compacted"));
            }
            other => panic!("expected notice event, got {other:?}"),
        }
    }

    #[test]
    fn map_notification_emits_deprecation_notice() {
        let mut mapper = TurnEventMapper::default();

        let events = mapper.map_notification(
            "deprecationNotice",
            &json!({
                "summary": "The legacy approval API is deprecated.",
                "details": "Use item/permissions/requestApproval instead."
            }),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            EngineEvent::Notice {
                kind,
                level,
                title,
                message,
            } => {
                assert_eq!(kind, "deprecation_notice");
                assert_eq!(level, "warning");
                assert_eq!(title, "Deprecation notice");
                assert!(message.contains("legacy approval API"));
                assert!(message.contains("item/permissions/requestApproval"));
            }
            other => panic!("expected notice event, got {other:?}"),
        }
    }

    #[test]
    fn map_notification_emits_hook_notice() {
        let mut mapper = TurnEventMapper::default();

        let events = mapper.map_notification(
            "hook/completed",
            &json!({
                "threadId": "thr_123",
                "run": {
                    "id": "hook_123",
                    "eventName": "sessionStart",
                    "executionMode": "sync",
                    "handlerType": "command",
                    "scope": "thread",
                    "sourcePath": "/tmp/hooks/session-start.sh",
                    "startedAt": 1735689600000i64,
                    "displayOrder": 1,
                    "status": "completed",
                    "entries": [
                        {
                            "kind": "feedback",
                            "text": "Workspace warmed."
                        }
                    ]
                }
            }),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            EngineEvent::Notice {
                kind,
                level,
                title,
                message,
            } => {
                assert_eq!(kind, "hook_completed_hook_123");
                assert_eq!(level, "info");
                assert_eq!(title, "Hook completed");
                assert!(message.contains("sessionStart hook via command"));
                assert!(message.contains("/tmp/hooks/session-start.sh"));
                assert!(message.contains("Workspace warmed."));
            }
            other => panic!("expected notice event, got {other:?}"),
        }
    }

    #[test]
    fn map_item_started_maps_collab_agent_tool_call() {
        let mut mapper = TurnEventMapper::default();

        let events = mapper.map_notification(
            "item/started",
            &json!({
                "threadId": "thr_123",
                "turnId": "turn_123",
                "item": {
                    "id": "collab_123",
                    "type": "collabAgentToolCall",
                    "tool": "spawnAgent",
                    "status": "inProgress",
                    "senderThreadId": "thr_123",
                    "receiverThreadIds": ["thr_child"],
                    "agentsStates": {}
                }
            }),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            EngineEvent::ActionStarted {
                action_type,
                summary,
                engine_action_id,
                ..
            } => {
                assert!(matches!(action_type, ActionType::Other));
                assert_eq!(summary, "Collaborative agent: spawnAgent");
                assert_eq!(engine_action_id.as_deref(), Some("collab_123"));
            }
            other => panic!("expected action started event, got {other:?}"),
        }
    }

    #[test]
    fn map_notification_emits_terminal_input_as_action_output() {
        let mut mapper = TurnEventMapper::default();
        let started_events = mapper.map_notification(
            "item/started",
            &json!({
                "item": {
                    "id": "cmd_123",
                    "type": "commandExecution",
                    "command": "pnpm test",
                    "commandActions": [],
                    "cwd": "/tmp/project",
                    "status": "inProgress"
                }
            }),
        );

        let action_id = match &started_events[0] {
            EngineEvent::ActionStarted { action_id, .. } => action_id.clone(),
            other => panic!("expected action started event, got {other:?}"),
        };

        let events = mapper.map_notification(
            "item/commandExecution/terminalInteraction",
            &json!({
                "threadId": "thr_123",
                "turnId": "turn_123",
                "itemId": "cmd_123",
                "processId": "pty_123",
                "stdin": "pnpm test\n"
            }),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            EngineEvent::ActionOutputDelta {
                action_id: actual_action_id,
                stream,
                content,
            } => {
                assert_eq!(actual_action_id, &action_id);
                assert!(matches!(stream, OutputStream::Stdin));
                assert_eq!(content, "pnpm test\n");
            }
            other => panic!("expected action output delta, got {other:?}"),
        }
    }

    #[test]
    fn map_notification_separates_reasoning_summary_parts() {
        let mut mapper = TurnEventMapper::default();

        let first = mapper.map_notification(
            "item/reasoning/summaryPartAdded",
            &json!({
                "itemId": "reasoning_123",
                "summaryIndex": 0,
                "threadId": "thr_123",
                "turnId": "turn_123"
            }),
        );
        let second = mapper.map_notification(
            "item/reasoning/summaryPartAdded",
            &json!({
                "itemId": "reasoning_123",
                "summaryIndex": 1,
                "threadId": "thr_123",
                "turnId": "turn_123"
            }),
        );

        assert!(first.is_empty());
        assert_eq!(second.len(), 1);
        match &second[0] {
            EngineEvent::ThinkingDelta { content } => assert_eq!(content, "\n"),
            other => panic!("expected thinking delta, got {other:?}"),
        }
    }

    #[test]
    fn map_notification_emits_mcp_progress_for_started_item() {
        let mut mapper = TurnEventMapper::default();
        let started_events = mapper.map_notification(
            "item/started",
            &json!({
                "item": {
                    "id": "item_123",
                    "type": "mcpToolCall",
                    "name": "search_docs"
                }
            }),
        );

        let action_id = match &started_events[0] {
            EngineEvent::ActionStarted { action_id, .. } => action_id.clone(),
            _ => panic!("expected action started event"),
        };

        let events = mapper.map_notification(
            "item/mcpToolCall/progress",
            &json!({
                "threadId": "thr_123",
                "turnId": "turn_123",
                "itemId": "item_123",
                "message": "Resolving server capabilities"
            }),
        );

        assert_eq!(events.len(), 1);
        match &events[0] {
            EngineEvent::ActionProgressUpdated {
                action_id: actual,
                message,
            } => {
                assert_eq!(actual, &action_id);
                assert_eq!(message, "Resolving server capabilities");
            }
            _ => panic!("expected action progress event"),
        }
    }

    #[test]
    fn map_notification_replays_latest_mcp_progress_when_item_starts() {
        let mut mapper = TurnEventMapper::default();

        let initial = mapper.map_notification(
            "item/mcpToolCall/progress",
            &json!({
                "threadId": "thr_123",
                "turnId": "turn_123",
                "itemId": "item_123",
                "message": "Queued"
            }),
        );
        assert!(initial.is_empty());

        let replacement = mapper.map_notification(
            "item/mcpToolCall/progress",
            &json!({
                "threadId": "thr_123",
                "turnId": "turn_123",
                "itemId": "item_123",
                "message": "Connecting"
            }),
        );
        assert!(replacement.is_empty());

        let started_events = mapper.map_notification(
            "item/started",
            &json!({
                "item": {
                    "id": "item_123",
                    "type": "mcpToolCall",
                    "name": "search_docs"
                }
            }),
        );

        assert_eq!(started_events.len(), 2);
        let action_id = match &started_events[0] {
            EngineEvent::ActionStarted { action_id, .. } => action_id.clone(),
            _ => panic!("expected action started event"),
        };

        match &started_events[1] {
            EngineEvent::ActionProgressUpdated {
                action_id: actual,
                message,
            } => {
                assert_eq!(actual, &action_id);
                assert_eq!(message, "Connecting");
            }
            _ => panic!("expected replayed action progress event"),
        }
    }

    #[test]
    fn map_rate_limits_snapshot_maps_five_hour_and_weekly_windows() {
        let mut mapper = TurnEventMapper::default();
        let payload = json!({
            "rateLimits": {
                "primary": {
                    "usedPercent": 17,
                    "windowDurationMins": 300,
                    "resetsAt": 1735689600
                },
                "secondary": {
                    "usedPercent": 42,
                    "windowDurationMins": 10080,
                    "resetsAt": 1736294400000i64
                }
            }
        });

        let event = mapper
            .map_rate_limits_snapshot(&payload)
            .expect("expected usage limits update");

        match event {
            EngineEvent::UsageLimitsUpdated { usage } => {
                assert_eq!(usage.five_hour_percent, Some(17));
                assert_eq!(usage.weekly_percent, Some(42));
                assert_eq!(usage.five_hour_resets_at, Some(1735689600 * 1000));
                assert_eq!(usage.weekly_resets_at, Some(1736294400000));
            }
            _ => panic!("expected usage limits update"),
        }
    }
}
