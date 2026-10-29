import WordExtractor from "word-extractor";
const x = new WordExtractor();
const d = await x.extract("sample-inputs/sample_blueprint.doc");
console.log(d.getBody());
