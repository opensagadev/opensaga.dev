use nusave::{apply_values, properties, property_description, property_editor, summary_rows, Save};
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

fn error(error: impl std::fmt::Display) -> JsValue {
    js_sys::Error::new(&error.to_string()).into()
}

fn serialize(value: &impl Serialize) -> Result<JsValue, JsValue> {
    serde_wasm_bindgen::to_value(value).map_err(error)
}

#[derive(Serialize)]
struct Summary {
    section: &'static str,
    label: String,
    value: String,
}

#[derive(Serialize)]
struct Snapshot {
    kind: &'static str,
    size: usize,
    checksum_valid: bool,
    modified: bool,
    summary: Vec<Summary>,
}

#[derive(Serialize)]
struct Field {
    name: String,
    kind: String,
    offset: usize,
    size: usize,
    description: &'static str,
    editor: Editor,
}

#[derive(Serialize)]
struct Editor {
    label: String,
    group: &'static str,
    input: &'static str,
    value: String,
    choices: Vec<Choice>,
    min: Option<i64>,
    max: Option<i64>,
    readonly: bool,
}
#[derive(Serialize)]
struct Choice {
    label: String,
    value: String,
}
#[derive(Deserialize)]
struct Edit {
    name: String,
    value: String,
}

#[derive(Serialize)]
struct FieldPage {
    total: usize,
    groups: Vec<&'static str>,
    fields: Vec<Field>,
}

#[wasm_bindgen]
pub struct WebSave {
    save: Save,
    original: Save,
}

impl WebSave {
    fn from_save(save: Save) -> Self {
        Self {
            original: save.clone(),
            save,
        }
    }
}

#[wasm_bindgen]
impl WebSave {
    #[wasm_bindgen(constructor)]
    pub fn new(bytes: Vec<u8>) -> Result<WebSave, JsValue> {
        Ok(Self::from_save(Save::parse(bytes).map_err(error)?))
    }

    pub fn create(options: bool) -> WebSave {
        Self::from_save(Save::fresh(options))
    }

    pub fn snapshot(&self) -> Result<JsValue, JsValue> {
        let fields = properties(&self.save);
        serialize(&Snapshot {
            kind: self.save.kind().description(),
            size: self.save.bytes.len(),
            checksum_valid: self.save.checksum_valid(),
            modified: self.save.bytes != self.original.bytes,
            summary: summary_rows(&self.save, &fields)
                .into_iter()
                .map(|row| Summary {
                    section: row.section,
                    label: row.label,
                    value: row.value,
                })
                .collect(),
        })
    }

    /// Return only one page of schema data; large reserved fields stay in the editor.
    pub fn fields(
        &self,
        query: &str,
        group: &str,
        advanced: bool,
        offset: usize,
    ) -> Result<JsValue, JsValue> {
        let query = query.to_ascii_lowercase();
        let fields = properties(&self.save);
        let editors: Vec<_> = fields
            .iter()
            .map(|field| (field, property_editor(&self.save, field)))
            .filter(|(_, editor)| advanced || !editor.advanced)
            .collect();
        let mut groups = Vec::new();
        for (_, editor) in &editors {
            if !groups.contains(&editor.group) {
                groups.push(editor.group);
            }
        }
        let matching: Vec<_> = editors
            .into_iter()
            .filter(|(field, editor)| {
                (group.is_empty() || group == editor.group)
                    && (query.is_empty()
                        || field.name.to_ascii_lowercase().contains(&query)
                        || editor.label.to_ascii_lowercase().contains(&query)
                        || property_description(&field.name)
                            .to_ascii_lowercase()
                            .contains(&query))
            })
            .collect();
        serialize(&FieldPage {
            total: matching.len(),
            groups,
            fields: matching
                .into_iter()
                .skip(offset)
                .take(50)
                .map(|(field, editor)| Field {
                    name: field.name.clone(),
                    kind: format!("{:?}", field.kind).to_ascii_lowercase(),
                    offset: field.offset,
                    size: field.size,
                    description: property_description(&field.name),
                    editor: Editor {
                        label: editor.label,
                        group: editor.group,
                        input: editor.input,
                        value: editor.value,
                        min: editor.min,
                        max: editor.max,
                        readonly: editor.readonly,
                        choices: editor
                            .choices
                            .into_iter()
                            .map(|c| Choice {
                                label: c.label,
                                value: c.value,
                            })
                            .collect(),
                    },
                })
                .collect(),
        })
    }

    pub fn edit(&mut self, values: JsValue, keep_derived: bool) -> Result<(), JsValue> {
        let values: Vec<Edit> = serde_wasm_bindgen::from_value(values).map_err(error)?;
        apply_values(
            &mut self.save,
            values.iter().map(|edit| (&edit.name, &edit.value)),
        )
        .map_err(error)?;
        if !keep_derived {
            self.save.derive();
        }
        Ok(())
    }

    pub fn reset(&mut self) {
        self.save = self.original.clone();
    }

    pub fn bytes(&self, keep_derived: bool) -> Result<Vec<u8>, JsValue> {
        let mut save = self.save.clone();
        if !keep_derived {
            save.derive();
        }
        let mut bytes = Vec::with_capacity(save.bytes.len());
        save.write_to(&mut bytes).map_err(error)?;
        Ok(bytes)
    }
}
