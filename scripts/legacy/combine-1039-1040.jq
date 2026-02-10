# Combine execution 1039 (Find New Connections2) with execution 1040 (Merge Connection + Email Data).
# Usage: jq -s -f scripts/legacy/combine-1039-1040.jq execution-1039.json execution-1040.json
# Output: { body: [ merged items with profile: "kyle" ] }

def norm($u): ($u // "") | tostring | gsub("https://www.linkedin.com"; "https://linkedin.com") | gsub("/$"; "");

(.[0]) as $e1039 |
(.[1]) as $e1040 |

($e1039.data.resultData.runData["Find New Connections2"][0].data.main[0] | map(.json)) as $connections |
($e1040.data.resultData.runData["Merge Connection + Email Data"][0].data.main[0] | map(.json) | map({key: norm(.profileUrl // .profileUrlNormalized // .linkedinProfileUrl), value: .}) | from_entries) as $byUrl |

[
  $connections[]
  | . as $conn
  | (norm($conn.profileUrl // $conn.profileUrlNormalized // $conn.linkedinProfileUrl)) as $url
  | ($conn + ($byUrl[$url] // {}) + { profile: "kyle" })
] | { body: . }
