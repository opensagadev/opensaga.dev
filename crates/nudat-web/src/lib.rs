use js_sys::{Function, Uint8Array};
use nudat::{ReaderArchive, Result as ArchiveResult};
use serde::Serialize;
use std::io::{self, Read, Seek, SeekFrom};
use wasm_bindgen::prelude::*;

// Read through FileReaderSync in a Web Worker. Cache small ranges so parsing
// thousands of index fields does not perform a Blob read for every integer.
// The whole archive is never copied into WebAssembly memory.
struct BlobReader {
    read_range: Function,
    size: u64,
    position: u64,
    cache_start: u64,
    cache: Vec<u8>,
}

impl Read for BlobReader {
    fn read(&mut self, output: &mut [u8]) -> io::Result<usize> {
        if self.position >= self.size || output.is_empty() {
            return Ok(0);
        }
        if self.cache.is_empty()
            || self.position < self.cache_start
            || self.position >= self.cache_start + self.cache.len() as u64
        {
            self.cache_start = self.position;
            let length = (self.size - self.position).min(64 * 1024);
            let result = self
                .read_range
                .call2(
                    &JsValue::NULL,
                    &JsValue::from_f64(self.position as f64),
                    &JsValue::from_f64(length as f64),
                )
                .map_err(|error| io::Error::other(format!("file read failed: {error:?}")))?;
            self.cache = Uint8Array::new(&result).to_vec();
            if self.cache.len() as u64 != length {
                return Err(io::Error::new(
                    io::ErrorKind::UnexpectedEof,
                    "short Blob read",
                ));
            }
        }
        let offset = (self.position - self.cache_start) as usize;
        let length = output.len().min(self.cache.len() - offset);
        output[..length].copy_from_slice(&self.cache[offset..offset + length]);
        self.position += length as u64;
        Ok(length)
    }
}

impl Seek for BlobReader {
    fn seek(&mut self, from: SeekFrom) -> io::Result<u64> {
        let position = match from {
            SeekFrom::Start(position) => i128::from(position),
            SeekFrom::End(offset) => i128::from(self.size) + i128::from(offset),
            SeekFrom::Current(offset) => i128::from(self.position) + i128::from(offset),
        };
        if !(0..=i128::from(u64::MAX)).contains(&position) {
            return Err(io::Error::new(io::ErrorKind::InvalidInput, "invalid seek"));
        }
        self.position = position as u64;
        Ok(self.position)
    }
}

fn js_error<T>(result: ArchiveResult<T>) -> Result<T, JsValue> {
    result.map_err(|error| js_sys::Error::new(&error.to_string()).into())
}

#[derive(Serialize)]
struct Entry<'a> {
    path: &'a str,
    size: u32,
    stored_size: u32,
    compression: String,
}

#[wasm_bindgen]
pub struct WebArchive {
    archive: ReaderArchive<BlobReader>,
}

#[wasm_bindgen]
impl WebArchive {
    #[wasm_bindgen(constructor)]
    pub fn new(size: f64, read_range: Function) -> Result<WebArchive, JsValue> {
        if !size.is_finite() || size < 0.0 || size.fract() != 0.0 || size > 9_007_199_254_740_991.0
        {
            return Err(js_sys::Error::new("invalid archive size").into());
        }
        let reader = BlobReader {
            read_range,
            size: size as u64,
            position: 0,
            cache_start: 0,
            cache: Vec::new(),
        };
        Ok(Self {
            archive: js_error(ReaderArchive::new(reader))?,
        })
    }

    pub fn version(&self) -> i32 {
        self.archive.version()
    }

    pub fn entries(&self) -> Result<JsValue, JsValue> {
        let entries: Vec<_> = self
            .archive
            .entries()
            .iter()
            .map(|entry| Entry {
                path: &entry.path,
                size: entry.size,
                stored_size: entry.stored_size,
                compression: format!("{:?}", entry.compression),
            })
            .collect();
        serde_wasm_bindgen::to_value(&entries)
            .map_err(|error| js_sys::Error::new(&error.to_string()).into())
    }

    pub fn read(&mut self, path: &str) -> Result<Vec<u8>, JsValue> {
        js_error(self.archive.read(path))
    }

    pub fn verify(&mut self) -> Result<(), JsValue> {
        js_error(self.archive.verify())
    }
}
