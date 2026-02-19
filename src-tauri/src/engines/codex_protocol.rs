use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

#[derive(Debug, Clone)]
pub enum IncomingMessage {
    Response(RpcResponse),
    Request {
        id: String,
        method: String,
        params: Value,
    },
    Notification {
        method: String,
        params: Value,
    },
}

#[derive(Debug, Clone)]
pub struct RpcResponse {
    pub id: String,
    pub result: Option<Value>,
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RpcError {
    #[serde(default)]
    pub code: Option<i64>,
    pub message: String,
    #[serde(default)]
    pub data: Option<Value>,
}

impl std::fmt::Display for RpcError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self.code {
            Some(code) => write!(f, "rpc error {code}: {}", self.message),
            None => write!(f, "rpc error: {}", self.message),
        }
    }
}

impl std::error::Error for RpcError {}

pub fn parse_incoming(line: &str) -> anyhow::Result<IncomingMessage> {
    let payload: Value = serde_json::from_str(line)
        .map_err(|error| anyhow::anyhow!("invalid JSON line: {error}; line={line}"))?;

    let object = payload
        .as_object()
        .ok_or_else(|| anyhow::anyhow!("incoming payload is not a JSON object"))?;

    let method = object
        .get("method")
        .and_then(Value::as_str)
        .map(str::to_string);
    let id = object.get("id").and_then(normalize_id);

    if let Some(method) = method {
        let params = object
            .get("params")
            .cloned()
            .unwrap_or_else(|| Value::Object(Map::new()));

        if let Some(id) = id {
            return Ok(IncomingMessage::Request { id, method, params });
        }

        return Ok(IncomingMessage::Notification { method, params });
    }

    if let Some(id) = id {
        let result = object.get("result").cloned();
        let error = object
            .get("error")
            .and_then(|raw| serde_json::from_value::<RpcError>(raw.clone()).ok());

        return Ok(IncomingMessage::Response(RpcResponse { id, result, error }));
    }

    Err(anyhow::anyhow!(
        "incoming payload is neither request/notification nor response: {payload}"
    ))
}

pub fn request_payload(id: &str, method: &str, params: Value) -> Value {
    serde_json::json!({
      "id": id,
      "method": method,
      "params": params,
    })
}

pub fn notification_payload(method: &str, params: Value) -> Value {
    serde_json::json!({
      "method": method,
      "params": params,
    })
}

pub fn response_success_payload(id: &str, result: Value) -> Value {
    serde_json::json!({
      "id": id,
      "result": result,
    })
}

pub fn response_error_payload(id: &str, code: i64, message: &str, data: Option<Value>) -> Value {
    serde_json::json!({
      "id": id,
      "error": {
        "code": code,
        "message": message,
        "data": data,
      }
    })
}

fn normalize_id(raw: &Value) -> Option<String> {
    match raw {
        Value::String(value) => Some(value.to_string()),
        Value::Number(value) => Some(value.to_string()),
        Value::Bool(value) => Some(value.to_string()),
        _ => None,
    }
}
