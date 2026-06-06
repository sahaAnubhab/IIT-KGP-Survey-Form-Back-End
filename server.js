require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const WebSocket = require('ws'); // <-- Fix for Node 20 WebSocket error

const app = express();
app.use(cors());
app.use(express.json()); // Allows Express to understand JSON bodies

// Initialize Supabase client with the WebSocket transport fix
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: false // Good practice for backend servers
    },
    realtime: {
      transport: WebSocket // <-- explicitly providing the ws package
    }
  }
);

// ==========================================
// ENDPOINT: Start a new survey session
// Used to test initial Supabase connectivity
// ==========================================
app.post('/api/start-session', async (req, res) => {
  try {
    const { consent_given, is_adult, city, makes_regular_trips } = req.body;

    // 1. Generate a random block assignment (1 to 4)
    const assignedBlock = Math.floor(Math.random() * 4) + 1;

    // 2. Insert the new respondent into Supabase
    const { data, error } = await supabase
      .from('respondents')
      .insert([
        {
          consent_given,
          is_adult,
          city,
          makes_regular_trips,
          assigned_block: assignedBlock
        }
      ])
      .select('id, assigned_block') // Return the new ID and their assigned block
      .single();

    if (error) throw error;

    // 3. Send the ID and block back to the frontend
    res.status(200).json({
      message: "Session started successfully. Connectivity working!",
      respondentId: data.id,
      assignedBlock: data.assigned_block
    });

  } catch (error) {
    console.error("Error starting session:", error);
    res.status(500).json({ error: "Failed to start survey session" });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});

// ==========================================
// ENDPOINT: Submit final survey data
// ==========================================
app.post('/api/submit-survey', async (req, res) => {
  try {
    const { respondentId, surveyAnswers, choiceAnswers } = req.body;

    if (!respondentId) {
      return res.status(400).json({ error: "Missing respondent ID" });
    }

    // 1. Mark the respondent as completed in the respondents table
    const { error: respondentError } = await supabase
      .from('respondents')
      .update({ completed: true })
      .eq('id', respondentId);

    if (respondentError) throw respondentError;

    // 2. Insert the general and demographic answers into survey_data
    // This saves all Section B, C, D, E, G, and H answers as one neat JSON object
    const { error: surveyError } = await supabase
      .from('survey_data')
      .insert([
        {
          respondent_id: respondentId,
          responses: surveyAnswers 
        }
      ]);

    if (surveyError) throw surveyError;

    // 3. Insert the 8 choice experiment answers into choice_responses
    // This maps the array from React into individual rows for Supabase
    const choiceInsertData = choiceAnswers.map((choice) => ({
      respondent_id: respondentId,
      card_number: choice.cardNumber,
      selected_option: choice.selectedOption
    }));

    const { error: choiceError } = await supabase
      .from('choice_responses')
      .insert(choiceInsertData);

    if (choiceError) throw choiceError;

    // 4. Send success response back to React
    res.status(200).json({ message: "Survey submitted successfully!" });

  } catch (error) {
    console.error("Error submitting survey:", error);
    res.status(500).json({ error: "Failed to submit survey data" });
  }
});