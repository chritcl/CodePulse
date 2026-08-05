use std::io::Read;

use serde::de::{DeserializeSeed, IgnoredAny, MapAccess, Visitor};
use serde::Deserializer;

pub const MAX_AGENT_HOOK_INPUT_BYTES: usize = 8 * 1024 * 1024;
const MAX_CAPTURED_FIELD_CHARS: usize = 2_048;
const MAX_COMMAND_PREFIX_CHARS: usize = 256;

#[derive(Debug, Default)]
pub struct AgentHookInput {
    pub session_id: Option<String>,
    pub turn_id: Option<String>,
    pub hook_event_name: Option<String>,
    pub cwd: Option<String>,
    pub tool_name: Option<String>,
    pub agent_id: Option<String>,
    pub parent_agent_id: Option<String>,
    pub task_id: Option<String>,
    pub agent_type: Option<String>,
    pub prompt: Option<String>,
    pub subject: Option<String>,
    pub status: Option<String>,
    pub stop_reason: Option<String>,
    pub outcome: Option<String>,
    pub command_prefix: Option<String>,
}

pub fn parse_agent_hook_input(
    reader: &mut impl Read,
    capture_task_summary: bool,
) -> Option<AgentHookInput> {
    let mut limited = reader.take((MAX_AGENT_HOOK_INPUT_BYTES + 1) as u64);
    let mut deserializer = serde_json::Deserializer::from_reader(&mut limited);
    let input = AgentHookInputSeed {
        capture_task_summary,
    }
    .deserialize(&mut deserializer)
    .ok()?;
    deserializer.end().ok()?;
    (limited.limit() > 0).then_some(input)
}

struct AgentHookInputSeed {
    capture_task_summary: bool,
}

impl<'de> DeserializeSeed<'de> for AgentHookInputSeed {
    type Value = AgentHookInput;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(AgentHookInputVisitor {
            capture_task_summary: self.capture_task_summary,
        })
    }
}

struct AgentHookInputVisitor {
    capture_task_summary: bool,
}

impl<'de> Visitor<'de> for AgentHookInputVisitor {
    type Value = AgentHookInput;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("Agent Hook JSON 对象")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut input = AgentHookInput::default();
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "session_id" => input.session_id = read_bounded_string(&mut map)?,
                "turn_id" => input.turn_id = read_bounded_string(&mut map)?,
                "hook_event_name" => input.hook_event_name = read_bounded_string(&mut map)?,
                "cwd" => input.cwd = read_bounded_string(&mut map)?,
                "tool_name" => input.tool_name = read_bounded_string(&mut map)?,
                "agent_id" => input.agent_id = read_bounded_string(&mut map)?,
                "parent_agent_id" => input.parent_agent_id = read_bounded_string(&mut map)?,
                "task_id" => input.task_id = read_bounded_string(&mut map)?,
                "agent_type" => input.agent_type = read_bounded_string(&mut map)?,
                "status" => input.status = read_bounded_string(&mut map)?,
                "stop_reason" => input.stop_reason = read_bounded_string(&mut map)?,
                "outcome" => input.outcome = read_bounded_string(&mut map)?,
                "prompt" if self.capture_task_summary => {
                    input.prompt = read_bounded_string(&mut map)?;
                }
                "subject" if self.capture_task_summary => {
                    input.subject = read_bounded_string(&mut map)?;
                }
                "tool_input" => {
                    input.command_prefix = map.next_value_seed(ToolInputSeed)?;
                }
                _ => {
                    map.next_value::<IgnoredAny>()?;
                }
            }
        }
        Ok(input)
    }
}

fn read_bounded_string<'de, A>(map: &mut A) -> Result<Option<String>, A::Error>
where
    A: MapAccess<'de>,
{
    map.next_value_seed(BoundedStringSeed {
        limit: MAX_CAPTURED_FIELD_CHARS,
        preserve_overflow: true,
    })
}

struct BoundedStringSeed {
    limit: usize,
    preserve_overflow: bool,
}

impl<'de> DeserializeSeed<'de> for BoundedStringSeed {
    type Value = Option<String>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(BoundedStringVisitor {
            limit: self.limit,
            preserve_overflow: self.preserve_overflow,
        })
    }
}

struct BoundedStringVisitor {
    limit: usize,
    preserve_overflow: bool,
}

impl Visitor<'_> for BoundedStringVisitor {
    type Value = Option<String>;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("字符串或 null")
    }

    fn visit_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        let limit = self.limit + usize::from(self.preserve_overflow);
        Ok(Some(value.chars().take(limit).collect()))
    }

    fn visit_borrowed_str<E>(self, value: &str) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        self.visit_str(value)
    }

    fn visit_string<E>(self, value: String) -> Result<Self::Value, E>
    where
        E: serde::de::Error,
    {
        self.visit_str(&value)
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(None)
    }
}

struct ToolInputSeed;

impl<'de> DeserializeSeed<'de> for ToolInputSeed {
    type Value = Option<String>;

    fn deserialize<D>(self, deserializer: D) -> Result<Self::Value, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_any(ToolInputVisitor)
    }
}

struct ToolInputVisitor;

impl<'de> Visitor<'de> for ToolInputVisitor {
    type Value = Option<String>;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("工具输入对象或 null")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut command = None;
        while let Some(key) = map.next_key::<String>()? {
            if key == "command" {
                command = map.next_value_seed(BoundedStringSeed {
                    limit: MAX_COMMAND_PREFIX_CHARS,
                    preserve_overflow: false,
                })?;
            } else {
                map.next_value::<IgnoredAny>()?;
            }
        }
        Ok(command)
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(None)
    }
}
