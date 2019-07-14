var EXPORTED_SYMBOLS = ["ProviderAutoCompleteSearch", "ProviderAutocompleteResult"];
const Ci = Components.interfaces;
const Cu = Components.utils;
 
Cu.import('resource://gre/modules/XPCOMUtils.jsm');
 
const CLASS_ID = Components.ID('21a54730-28ce-11e2-81c1-0800200c9a66');
const CLASS_NAME = "FlashGot Autocomplete";
const CONTRACT_ID = '@mozilla.org/autocomplete/search;1?name=flashgot-autocomplete';
 
/**
 * @constructor
 *
 * @implements {nsIAutoCompleteResult}
 *
 * @param {string} searchString
 * @param {number} searchResult
 * @param {number} defaultIndex
 * @param {string} errorDescription
 * @param {Array.<string>} results
 * @param {Array.<string>|null=} comments
 */
function ProviderAutoCompleteResult(searchString, searchResult,
  defaultIndex, errorDescription, results, comments) {
  this._searchString = searchString;
  this._searchResult = searchResult;
  this._defaultIndex = defaultIndex;
  this._errorDescription = errorDescription;
  this._results = results;
  this._comments = comments;
}
 
ProviderAutoCompleteResult.prototype = {
  _searchString: "",
  _searchResult: 0,
  _defaultIndex: 0,
  _errorDescription: "",
  _results: [],
  _comments: [],
 
  /**
   * @return {string} the original search string
   */
  get searchString() {
    return this._searchString;
  },
 
  /**
   * @return {number} the result code of this result object, either:
   *   RESULT_IGNORED   (invalid searchString)
   *   RESULT_FAILURE   (failure)
   *   RESULT_NOMATCH   (no matches found)
   *   RESULT_SUCCESS   (matches found)
   */
  get searchResult() {
    return this._searchResult;
  },
 
  /**
   * @return {number} the index of the default item that should be entered if
   *   none is selected
   */
  get defaultIndex() {
    return this._defaultIndex;
  },
 
  /**
   * @return {string} description of the cause of a search failure
   */
  get errorDescription() {
    return this._errorDescription;
  },
 
  /**
   * @return {number} the number of matches
   */
  get matchCount() {
    return this._results.length;
  },
 
  /**
   * @return {string} the value of the result at the given index
   */
  getValueAt: function(index) {
    return this._results[index];
  },
 
  /**
   * @return {string} the comment of the result at the given index
   */
  getCommentAt: function(index) {
    if (this._comments)
      return this._comments[index];
    else
      return '';
  },
 
  /**
   * @return {string} the style hint for the result at the given index
   */
  getStyleAt: function(index) {
    if (!this._comments || !this._comments[index])
      return null;  // not a category label, so no special styling
 
    if (index == 0)
      return 'suggestfirst';  // category label on first line of results
 
    return 'suggesthint';   // category label on any other line of results
  },
 
  /**
   * Gets the image for the result at the given index
   *
   * @return {string} the URI to the image to display
   */
  getImageAt : function (index) {
    return '';
  },
 
  /**
   * Removes the value at the given index from the autocomplete results.
   * If removeFromDb is set to true, the value should be removed from
   * persistent storage as well.
   */
  removeValueAt: function(index, removeFromDb) {
    this._results.splice(index, 1);
 
    if (this._comments)
      this._comments.splice(index, 1);
  },
 
  getLabelAt: function(index) { return this._results[index]; },
 
  QueryInterface: XPCOMUtils.generateQI([ Ci.nsIAutoCompleteResult ])
};
 
 

var ProviderAutoCompleteSearch = {
 
  classID: CLASS_ID,
  classDescription : CLASS_NAME,
  contractID : CONTRACT_ID,
  
  /**
   * Searches for a given string and notifies a listener (either synchronously
   * or asynchronously) of the result
   *
   * @param searchString the string to search for
   * @param searchParam an extra parameter
   * @param previousResult a previous result to use for faster searchinig
   * @param listener the listener to notify when the search is complete
   */
  startSearch: function(searchString, searchParam, previousResult, listener) {
    try {
      var results = searchParam && JSON.parse(searchParam) || [];
      if (results.length) {
        let top = results.filter(
            function(s) s.toLowerCase().indexOf(searchString) !== -1
        ) || [];
        for (let j = top.length; j-- > 0;) {
          let r = top[j];
          let i = results.indexOf(r);
          if (i !== -1) results.splice(j, 1);
          results.unshift(r);
        }
      }
      listener.onSearchResult(this, new ProviderAutoCompleteResult(searchString,
          Ci.nsIAutoCompleteResult.RESULT_SUCCESS, 0, "", results, null));
    } catch (e) {
      Cu.reportError(e);
    }
  },
 
  /**
   * Stops an asynchronous search that is in progress
   */
  stopSearch: function() {},
  createInstance: function() this, 
  QueryInterface: XPCOMUtils.generateQI([ Ci.nsIAutoCompleteSearch,  Ci.nsIFactory ])
};

Components.manager.QueryInterface(Ci.nsIComponentRegistrar)
  .registerFactory(CLASS_ID, CLASS_NAME, CONTRACT_ID,ProviderAutoCompleteSearch);
