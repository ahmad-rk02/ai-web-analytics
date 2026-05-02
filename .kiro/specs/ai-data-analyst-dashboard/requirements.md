# Requirements Document

## Introduction

The AI Data Analyst Dashboard is a web-based application that enables non-technical users to upload CSV data files, ask questions in natural language, and receive instant insights through charts and text summaries. The system combines a Next.js frontend, a Node.js/Express backend, an AI language model layer (OpenAI or Gemini), and a CSV processing pipeline to eliminate the need for manual data analysis.

## Glossary

- **Dashboard**: The main web UI where users interact with uploaded data and AI-generated insights.
- **CSV_Processor**: The component responsible for parsing, validating, and storing uploaded CSV file data.
- **AI_Query_Engine**: The component that converts natural language questions into structured query logic using an LLM API.
- **Query_Executor**: The component that runs structured query logic against the parsed dataset and returns results.
- **Visualization_Engine**: The frontend component that renders query results as charts (bar, line, pie) or text summaries.
- **Session**: A user's active working context tied to a single uploaded CSV file.
- **Insight**: A text summary or chart produced in response to a user's natural language question.
- **Structured_Query**: An intermediate representation (pseudo-SQL or JSON logic) produced by the AI_Query_Engine from a natural language question.

---

## Requirements

### Requirement 1: CSV File Upload

**User Story:** As a non-technical user, I want to upload a CSV file, so that I can analyze my data without writing any code.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a file upload control that accepts files with the `.csv` extension.
2. WHEN a user selects a CSV file under 10 MB, THE CSV_Processor SHALL parse the file and store the resulting dataset in the active Session.
3. IF a user uploads a file exceeding 10 MB, THEN THE Dashboard SHALL display an error message stating the file size limit.
4. IF a user uploads a file that is not a valid CSV, THEN THE CSV_Processor SHALL return a descriptive error message identifying the parsing failure.
5. WHEN a CSV file is successfully parsed, THE Dashboard SHALL display a preview of the first 10 rows and the detected column names and data types.
6. THE CSV_Processor SHALL format parsed dataset metadata (column names, types, row count) into a structured schema object for use by the AI_Query_Engine.
7. FOR ALL valid CSV files, parsing then re-serializing then parsing SHALL produce a dataset with equivalent column names, data types, and row count (round-trip property).

---

### Requirement 2: Natural Language Question Input

**User Story:** As a non-technical user, I want to type a question in plain English, so that I can query my data without knowing SQL or programming.

#### Acceptance Criteria

1. WHILE a Session contains a parsed dataset, THE Dashboard SHALL display a text input field for natural language questions.
2. WHEN a user submits a question, THE AI_Query_Engine SHALL receive the question text and the dataset schema object.
3. THE AI_Query_Engine SHALL convert the natural language question into a Structured_Query within 10 seconds.
4. IF the AI_Query_Engine cannot produce a valid Structured_Query from the question, THEN THE Dashboard SHALL display a message asking the user to rephrase the question.
5. THE AI_Query_Engine SHALL support questions involving aggregation (sum, average, count), filtering (by value or date range), ranking (top N), and trend analysis (grouped by time period).

---

### Requirement 3: Query Execution Against Dataset

**User Story:** As a non-technical user, I want the system to run my question against my data, so that I get accurate results from my actual dataset.

#### Acceptance Criteria

1. WHEN a Structured_Query is produced, THE Query_Executor SHALL execute it against the active Session's dataset.
2. THE Query_Executor SHALL return a result set containing the relevant rows, aggregated values, or computed metrics as specified by the Structured_Query.
3. IF the Structured_Query references a column name that does not exist in the dataset, THEN THE Query_Executor SHALL return an error identifying the missing column.
4. WHEN the dataset contains no rows matching the query conditions, THE Query_Executor SHALL return an empty result set and THE Dashboard SHALL display a "No results found" message.
5. THE Query_Executor SHALL complete execution within 5 seconds for datasets up to 50,000 rows.

---

### Requirement 4: Data Visualization

**User Story:** As a non-technical user, I want to see my results as charts, so that I can understand trends and patterns at a glance.

#### Acceptance Criteria

1. WHEN a Query_Executor result set is suitable for trend analysis, THE Visualization_Engine SHALL render a line chart.
2. WHEN a Query_Executor result set is suitable for category comparison, THE Visualization_Engine SHALL render a bar chart.
3. WHEN a Query_Executor result set is suitable for proportional breakdown, THE Visualization_Engine SHALL render a pie chart.
4. THE AI_Query_Engine SHALL include a recommended chart type in the Structured_Query response.
5. THE Dashboard SHALL allow the user to switch between available chart types (bar, line, pie) for any given result set.
6. WHEN a chart is rendered, THE Visualization_Engine SHALL label axes with the corresponding column names from the dataset.

---

### Requirement 5: Text Insight Summaries

**User Story:** As a non-technical user, I want a plain-English summary of my query results, so that I can understand the key takeaway without reading raw numbers.

#### Acceptance Criteria

1. WHEN a Query_Executor result set is returned, THE AI_Query_Engine SHALL generate a concise text summary of no more than 100 words describing the key finding.
2. THE Dashboard SHALL display the text summary alongside the chart for every Insight.
3. IF the result set is empty, THEN THE AI_Query_Engine SHALL generate a summary stating that no matching data was found for the question.

---

### Requirement 6: Insight History

**User Story:** As a non-technical user, I want to see all the questions I asked and their results during my session, so that I can compare insights without re-running queries.

#### Acceptance Criteria

1. THE Dashboard SHALL maintain an ordered list of all Insights generated within the active Session.
2. WHEN a new Insight is generated, THE Dashboard SHALL append it to the top of the Insight history list.
3. WHILE a Session is active, THE Dashboard SHALL display all previous Insights in the history list without requiring a page reload.
4. THE Dashboard SHALL display the original question text alongside each Insight in the history list.

---

### Requirement 7: Session Management

**User Story:** As a non-technical user, I want to start a new analysis with a different file, so that I can switch datasets without confusion.

#### Acceptance Criteria

1. THE Dashboard SHALL provide a "New Session" control that clears the active dataset and Insight history.
2. WHEN a user initiates a New Session, THE Dashboard SHALL prompt the user to confirm before discarding the current Session data.
3. WHEN a new CSV file is uploaded, THE Dashboard SHALL replace the active Session dataset and clear the Insight history.
4. IF a user attempts to submit a question without an active Session dataset, THEN THE Dashboard SHALL display a message instructing the user to upload a CSV file first.

---

### Requirement 8: Error Handling and Resilience

**User Story:** As a non-technical user, I want clear error messages when something goes wrong, so that I know what to do next.

#### Acceptance Criteria

1. IF the AI_Query_Engine API call fails due to a network error, THEN THE Dashboard SHALL display a message stating the AI service is unavailable and prompt the user to retry.
2. IF the AI_Query_Engine API call returns an error response, THEN THE Dashboard SHALL display the error reason and allow the user to modify and resubmit the question.
3. WHEN an error occurs during query execution, THE Query_Executor SHALL log the error with the Structured_Query details and return a structured error object to the Dashboard.
4. THE Dashboard SHALL display all error messages in a consistent, visible error notification component.
