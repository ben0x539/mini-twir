function pushText(n, s) {
  n.appendChild(document.createTextNode(s));
}
function pushElement(n, tag, text, attrs) {
  var elem = document.createElement(tag);
  if (text)
    pushText(elem, text);
  if (attrs) {
    for (var k in attrs) {
      elem.setAttribute(k, attrs[k]);
    }
  }
  n.appendChild(elem);
  return elem;
}

var cb_counter = 0;
function jsonp(url) {
  return new Promise(function(resolve, reject) {
    var sep = "?";
    if (url.indexOf("?") != -1)
      sep = "&";
    pushElement(document.head, "script", null,
      { src: url + sep + "callback=" + generateCallback(resolve, reject) });
  });

  function generateCallback(resolve, reject) {
    var name = "_cb_" + cb_counter++; //Math.floor(Math.random() * 0xffffff);

    window[name] = function(response) {
      delete window[name];
      if (response.meta.status == 200) {
        resolve(response.data);
      } else {
        var e = new Error(response.data.message);
        e.response = response;
        reject(e);
      }
    };

    return name;
  }
}

//function http_get(url) {
//  return new Promise(function(resolve, reject) {
//    var req = new XMLHttpRequest();
//    req.onload = function() {
//      if (req.status == 200) {
//        resolve(req.response);
//      } else {
//        reject(Error(req.statusText));
//      }
//    };
//    req.onerror = function() {
//      reject(Error("Network error"));
//    };
//    req.open("GET", url);
//    req.send();
//  });
//}

var prsElem = document.getElementById("prs");
var breakingPrs = pushElement(prsElem, "div");
var otherPrs = pushElement(prsElem, "div");
pushElement(breakingPrs, "h2", "Breaking changes");
pushElement(otherPrs, "h2", "Other PRs");
breakingPrs = pushElement(breakingPrs, "ul");
otherPrs = pushElement(otherPrs, "ul");

function getPrMergeCommits() {
  const MERGE_COMMIT_RE = /^auto merge of #(\d+) : /;

  return go(1, []);

  function go(n, merges) {
    var p =
      jsonp("https://api.github.com/repos/mozilla/rust/commits?page=" + n);
    return p.then(function(commits) {
      var cutoff = Date.now() - 1000*60*60*24*7;
      var done = false;

      for (var i = 0; i < commits.length; ++i) {
        var commit = commits[i];
        try {
          if (!commit.author || commit.author.login != "bors"
              || commit.parents.length < 2)
            continue;
          var commit_ = commit.commit;
          if (Date.parse(commit_.author.date) < cutoff) {
            done = true;
            break;
          }

          var pr_match = MERGE_COMMIT_RE.exec(commit_.message);
          if (pr_match) {
            commit.pull_request_num = pr_match[1];
            merges.push(commit);
          }
        } catch (e) {
          e.commit = commit;
          throw e;
        }
      }

      if (done || commits.length == 0) {
        return merges;
      } else {
        return go(n + 1, merges);
      }
    });
  }
}

function getPrsForMerges(merges) {
  var lowest;
  var mergesByPrNum = {};
  for (var i = 0; i < merges.length; ++i) {
    var merge = merges[i];
    var pr_num = merges[i].pull_request_num;
    mergesByPrNum[pr_num] = merge;
    if (!lowest || pr_num < lowest)
      lowest = pr_num;
  }
  if (!lowest)
    return Promise.resolve([]);

  return go(1, lowest, mergesByPrNum);

  function go(n, lowest, mergesByPrNum) {
    var p =
      jsonp("https://api.github.com/repos/mozilla/rust/pulls?state=all&sort=created&direction=desc&page=" + n);
    return p.then(function(pulls) {
      var done = false;
      for (var i = 0; i < pulls.length; ++i) {
        var pull = pulls[i];
        var num = pull.number;
        if (num < lowest) {
          done = true;
          break;
        }

        var merge = mergesByPrNum[num];
        if (merge)
          merge.pull_request = pull;
      }

      if (!done && pulls.length > 0)
        return go(n + 1, lowest, mergesByPrNum);
    });
  }
}

getPrMergeCommits().then(function(merges) {
  return getPrsForMerges(merges).then(function() { return merges; });
}).then(function(merges) {
  for (var i = 0; i < merges.length; ++i) {
    var merge = merges[i];
    var pull = merge.pull_request;
    if (!pull) {
      console.error("Didn't find pr #" + merge.pull_request_num);
      continue;
    }

    try {
      var section;
      if (pull.body.indexOf("[breaking-change]") != -1) {
        section = breakingPrs;
      } else {
        section = otherPrs;
      }

      listPr(section, merge);
    } catch (e) {
      e.commit = merge;
      throw e;
    }
  }
}).catch(function(e) {
  var div = pushElement(prsElem, "div", null,
    { class: "error" });
  pushElement(div, "h3", "Error (" + e.name + ")");
  pushElement(prsElem, "p", e.message);
  if (e.response && Object.prototype.toSource)
    pushElement(prsElem, "p", e.response.meta.toSource());
  console.error(e);
  throw e;
});

function listPr(section, merge) {
  var dateStr = merge.commit.author.date.slice(0, 10);
  var pull = merge.pull_request;

  var li = pushElement(section, "li");
  var user = pull.user;
  var authorDiv = pushElement(li, "div", null,
    { class: "author" });
  var authorLink = pushElement(authorDiv, "a", null,
    { href: user.html_url });
  var avatar = user.avatar_url;
  if (avatar) {
    if (avatar.indexOf("?") == -1)
      avatar += "?s=126";
    else
      avatar += "&s=126";
    pushElement(authorLink, "img", null,
      { src: avatar, width: 126, height: 126 });
  }
  pushText(authorLink, "@" + user.login);

  var p = pushElement(li, "p");
  pushElement(p, "a", "PR #" + pull.number, { href: pull.html_url });
  pushText(p, " (" + dateStr + ") for ");
  user = pull.head.user.login;
  var ref = pull.head.ref;
  pushElement(p, "a", user + "/" + ref,
    { href: pull.head.repo.html_url + "/tree/" + ref });
  var title = pushElement(li, "h4", pull.title);

  pushElement(li, "p", pull.body, { class: "pullBody" } );
}
