import React from "react";
import {createRoot} from "react-dom/client";
import {App} from "./App.js";
import "./style.css";

const el=document.getElementById("root");
if(!el)throw Error("Missing React root");
createRoot(el).render(<React.StrictMode><App/></React.StrictMode>);
