// Anderson on Allowance — forwards bank purchase alerts from Gmail.
const ENDPOINT = '__ENDPOINT__';
const SYNC_KEY = '__SYNC_KEY__';
const QUERY = 'from:(scotiabank OR cardwise OR collabria OR coastcapital) newer_than:2d';

function forwardAlerts() {
  const props = PropertiesService.getScriptProperties();
  const sent = JSON.parse(props.getProperty('sent') || '{}');
  const cutoff = Date.now() - 4 * 864e5;
  for (const id in sent) if (sent[id] < cutoff) delete sent[id];

  for (const thread of GmailApp.search(QUERY, 0, 50)) {
    for (const msg of thread.getMessages()) {
      const id = msg.getId();
      if (sent[id] || msg.getDate().getTime() < cutoff) continue;
      const res = UrlFetchApp.fetch(ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        headers: { Authorization: 'Bearer ' + SYNC_KEY },
        payload: JSON.stringify({
          id: id,
          from: msg.getFrom(),
          subject: msg.getSubject(),
          date: msg.getDate().toISOString(),
          body: msg.getPlainBody().slice(0, 4000),
        }),
        muteHttpExceptions: true,
      });
      if (res.getResponseCode() === 200) sent[id] = Date.now();
    }
  }
  props.setProperty('sent', JSON.stringify(sent));
}

function install() {
  ScriptApp.getProjectTriggers().forEach(function (t) { ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('forwardAlerts').timeBased().everyMinutes(5).create();
  forwardAlerts();
}
