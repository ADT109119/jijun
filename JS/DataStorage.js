// JavaScript Document

var AllTheData = {}; //所有"記帳"資料 不包括設定
var SelectedClass = "";
var InOrOut = "OutType";
var JiJunClasses = [[],[]];
var ChaJunClasses = [[],[]];


//console.log(localStorage.getItem("AllTheData"));

//開啟網頁時 若localStorage不為空 則取出資料
if(localStorage.getItem("AllTheData") != "" && localStorage.getItem("AllTheData") != null)
	AllTheData = JSON.parse(localStorage.getItem("AllTheData"));

function SaveData(){
	let InputDate = document.querySelector(".InputDate").value.split("-");
	let Money = parseFloat(document.querySelector(".MoneyDisplay").innerHTML);
	let Description = document.querySelector(".DescriptionInput").value;
	
	if(Money == ""){
		alert("請輸入金額");
		return 0;
	}
	
	if(SelectedClass == ""){
		alert("請輸選擇分類");
		return 0;
	}
	
	if(tempData[InOrOut][SelectedClass]["money"] == undefined){
		tempData[InOrOut][SelectedClass]["money"] = [""];
		tempData[InOrOut][SelectedClass]["description"] = [""];
	}
	
	
	tempData[InOrOut][SelectedClass]["money"].push(Money);
	tempData[InOrOut][SelectedClass]["description"].push(Description);
	
	
	if(AllTheData[InputDate[0]] == "" || AllTheData[InputDate[0]] == undefined)
		AllTheData[InputDate[0]] = JSON.parse(AllTheDataStyleStr);
	
	AllTheData[InputDate[0]][InputDate[1]][InputDate[2]] = tempData;
	
	//console.log(AllTheData[InputDate[0]][InputDate[1]])
	
	document.querySelector(".MoneyDisplay").innerHTML = "0";
	document.querySelector(".DescriptionInput").value = "";
	localStorage.setItem("AllTheData", JSON.stringify(AllTheData));
	HomePageMoneyDisplay();
	DisplaySaveSuccess();
}


function LoadDataOnDateChange(obj){
	let vv = obj.value.split("-");
	tempData = AllTheData[vv[0]][vv[1]][vv[2]];
	
	if(tempData == "" || tempData == undefined)
		tempData = JSON.parse(tempDataStyleStr);
}




//網頁中暫存資料
var tempDataStyle = {
		OutType:{
			food: {},
			
			life: {},
			
			traffic: {},
			
			fun: {},
			
			medi: {},
			
			edu: {},
			
			another: {}
		},
	
		InType:{
			salary: {},
			
			bonus: {},
			
			pocket: {},
			
			parttime: {},
			
			invest: {},
			
			interest: {},
			
			another: {}
		}
	};
	
var tempDataStyleStr = JSON.stringify(tempDataStyle);
	
var tempData = JSON.parse(tempDataStyleStr);

//AllTheData格式

var AllTheDataStyle = {
	"01": {},
	"02": {},
	"03": {},
	"04": {},
	"05": {},
	"06": {},
	"07": {},
	"08": {},
	"09": {},
	"10": {},
	"11": {},
	"12": {}
};

var AllTheDataStyleStr = JSON.stringify(AllTheDataStyle);




