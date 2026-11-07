// TODO(Hrithik): replace this one-page form with the real step-by-step quiz.
import { API_BASE } from "../src/config.js";

const form = document.getElementById("quiz");
const status = document.getElementById("status");

function optionInput(question, option, type) {
  const label = document.createElement("label");
  const input = document.createElement("input");
  input.type = type;
  input.name = question.id;
  input.value = option.value;
  label.append(input, ` ${option.label}`);
  return label;
}

function numberInput(name, labelText, attributes) {
  const label = document.createElement("label");
  const input = Object.assign(document.createElement("input"), { type: "number", name, ...attributes });
  label.append(`${labelText} `, input);
  return label;
}

function renderQuestion(question) {
  const fieldset = document.createElement("fieldset");
  const legend = document.createElement("legend");
  legend.textContent = question.title;
  fieldset.append(legend);
  if (question.type === "number") {
    const { min, max, step } = question;
    fieldset.append(numberInput(question.id, question.unit, { min, max, step }));
  } else if (question.type === "weights") {
    for (const option of question.options) {
      fieldset.append(numberInput(`weight_${option.value}`, option.label, { min: 0, max: 100, value: 33 }));
    }
  } else {
    const type = question.type === "multi" ? "checkbox" : "radio";
    for (const option of question.options) fieldset.append(optionInput(question, option, type));
  }
  return fieldset;
}

function readProfile(quiz, data) {
  const profile = { version: quiz.version };
  for (const question of quiz.questions) {
    if (question.type === "weights") {
      profile.weights = Object.fromEntries(
        question.options.map((option) => [option.value, Number(data.get(`weight_${option.value}`))]),
      );
    } else if (question.type === "multi") {
      profile[question.id] = data.getAll(question.id);
    } else if (question.type === "number" || question.id === "min_bedrooms") {
      profile[question.id] = Number(data.get(question.id));
    } else {
      profile[question.id] = data.get(question.id);
    }
  }
  return profile;
}

try {
  const quiz = await (await fetch(`${API_BASE}/quiz`)).json();
  form.append(...quiz.questions.map(renderQuestion));
  const submit = document.createElement("button");
  submit.textContent = "Save my profile";
  form.append(submit);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await chrome.storage.local.set({ profile: readProfile(quiz, new FormData(form)) });
    status.textContent = "Saved. Open a Sydney listing to see your match.";
  });
} catch {
  status.textContent = "Could not load the quiz. Is the backend running?";
}
